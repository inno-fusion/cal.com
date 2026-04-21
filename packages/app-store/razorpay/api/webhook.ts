import process from "node:process";
import { IS_PRODUCTION } from "@calcom/lib/constants";
import logger from "@calcom/lib/logger";
import { safeStringify } from "@calcom/lib/safeStringify";
import { getServerErrorFromUnknown } from "@calcom/lib/server/getServerErrorFromUnknown";
import { prisma } from "@calcom/prisma";
import { buffer } from "micro";
import type { NextApiRequest, NextApiResponse } from "next";
import { verifyWebhookSignature } from "../lib/signatures";
import { processWebhookEvent } from "../lib/webhookHandler";
import { razorpayCredentialSchema, webhookEventSchema } from "../zod";

const log = logger.getSubLogger({ prefix: ["razorpay-webhook"] });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ message: "Method Not Allowed" });
    }

    const signature = req.headers["x-razorpay-signature"];
    const eventId = req.headers["x-razorpay-event-id"];

    if (!signature || typeof signature !== "string") {
      log.warn("webhook: missing x-razorpay-signature header");
      return res.status(400).json({ message: "Missing x-razorpay-signature header" });
    }

    if (!eventId || typeof eventId !== "string") {
      log.warn("webhook: missing x-razorpay-event-id header");
      return res.status(400).json({ message: "Missing x-razorpay-event-id header" });
    }

    const rawBody = (await buffer(req)).toString("utf8");

    // Dedup check: if we already processed this event, return early
    const existingEvent = await prisma.razorpayWebhookEvent.findUnique({
      where: { eventId },
    });

    if (existingEvent) {
      log.info("webhook: duplicate event received", { eventId });
      return res.status(200).json({ received: true, duplicate: true });
    }

    // Parse and validate the event payload
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      log.error("webhook: failed to parse JSON body");
      return res.status(400).json({ message: "Invalid JSON body" });
    }

    const eventParsing = webhookEventSchema.safeParse(parsedBody);
    if (!eventParsing.success) {
      log.error("webhook: invalid event schema", { errors: eventParsing.error.flatten() });
      return res.status(500).json({ message: "Invalid event payload" });
    }

    const event = eventParsing.data;

    // Resolve webhook secret from the payment's associated credential
    let webhookSecret: string | undefined;

    const paymentPayload = event.payload.payment?.entity as
      | { order_id?: string; payment_id?: string }
      | undefined;
    const refundPayload = event.payload.refund?.entity as { payment_id?: string } | undefined;
    const orderPayload = event.payload.order?.entity as { id?: string } | undefined;

    const orderId = paymentPayload?.order_id ?? orderPayload?.id;
    const razorpayPaymentId = refundPayload?.payment_id;

    if (orderId) {
      const payment = await prisma.payment.findFirst({
        where: { externalId: orderId },
        select: {
          appId: true,
          booking: {
            select: { userId: true },
          },
        },
      });

      if (payment?.booking?.userId) {
        const credential = await prisma.credential.findFirst({
          where: { appId: payment.appId ?? "razorpay", userId: payment.booking.userId },
          select: { key: true },
        });

        if (credential) {
          const keysParsing = razorpayCredentialSchema.safeParse(credential.key);
          if (keysParsing.success) {
            webhookSecret = keysParsing.data.webhook_secret;
          }
        }
      }
    } else if (razorpayPaymentId) {
      const payment = await prisma.payment.findFirst({
        where: { data: { path: ["paymentId"], equals: razorpayPaymentId } },
        select: {
          appId: true,
          booking: {
            select: { userId: true },
          },
        },
      });

      if (payment?.booking?.userId) {
        const credential = await prisma.credential.findFirst({
          where: { appId: payment.appId ?? "razorpay", userId: payment.booking.userId },
          select: { key: true },
        });

        if (credential) {
          const keysParsing = razorpayCredentialSchema.safeParse(credential.key);
          if (keysParsing.success) {
            webhookSecret = keysParsing.data.webhook_secret;
          }
        }
      }
    }

    // Fallback to global env var if per-credential lookup failed
    if (!webhookSecret) {
      webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    }

    if (!webhookSecret) {
      log.error("webhook: no webhook secret available");
      return res.status(500).json({ message: "Webhook secret not configured" });
    }

    const isValid = verifyWebhookSignature(rawBody, signature, webhookSecret);
    if (!isValid) {
      log.warn("webhook: signature verification failed", { eventId });
      return res.status(400).json({ message: "Invalid signature" });
    }

    // CRITICAL ORDERING: process BEFORE inserting dedup row.
    // If processing fails, dedup row is NOT inserted so Razorpay will retry.
    await processWebhookEvent(event);

    // Insert dedup row after successful processing
    try {
      await prisma.razorpayWebhookEvent.create({ data: { eventId } });
    } catch (e) {
      // Handle race: another request inserted the dedup row concurrently (P2002 unique violation)
      const err = getServerErrorFromUnknown(e);
      if ((e as { code?: string }).code !== "P2002") {
        log.warn("webhook: dedup insert failed (non-race error)", { eventId, error: err.message });
      }
      // Either way, processing succeeded — return 200
    }

    return res.status(200).json({ received: true });
  } catch (_err) {
    const err = getServerErrorFromUnknown(_err);
    log.error("webhook: unhandled error", { message: err.message });
    res.status(500).json({
      message: err.message,
      stack: IS_PRODUCTION ? undefined : err.cause?.stack,
    });
  }
}
