import logger from "@calcom/lib/logger";
import type { TraceContext } from "@calcom/lib/tracing";
import { distributedTracing } from "@calcom/lib/tracing/factory";
import { prisma } from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";
import { handlePaymentSuccessIdempotent } from "../lib/handlePaymentSuccessIdempotent";
import { verifyPaymentSignature } from "../lib/signatures";
import { razorpayCredentialSchema, verifyRequestSchema } from "../zod";

const log = logger.getSubLogger({ prefix: ["razorpay-verify"] });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const parseResult = verifyRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    log.warn("verify: invalid request body", { errors: parseResult.error.flatten() });
    return res.status(400).json({ message: "Bad Request", errors: parseResult.error.flatten() });
  }

  const { razorpay_payment_id, razorpay_order_id, razorpay_signature, paymentUid } = parseResult.data;

  const payment = await prisma.payment.findFirst({
    where: { uid: paymentUid },
    select: {
      id: true,
      bookingId: true,
      externalId: true,
      appId: true,
      data: true,
      booking: {
        select: {
          uid: true,
          userId: true,
        },
      },
    },
  });

  if (!payment) {
    log.warn("verify: payment not found", { paymentUid });
    return res.status(404).json({ message: "Payment not found" });
  }

  if (payment.externalId !== razorpay_order_id) {
    log.warn("verify: order_id mismatch", {
      expected: payment.externalId,
      received: razorpay_order_id,
    });
    return res.status(400).json({ message: "Order ID mismatch" });
  }

  // Resolve credential — userId-only lookup matching RegularBookingService's create path
  const credential = await prisma.credential.findFirst({
    where: {
      appId: payment.appId ?? "razorpay",
      userId: payment.booking?.userId,
    },
    select: { key: true },
  });

  if (!credential) {
    log.error("verify: credential not found", { userId: payment.booking?.userId });
    return res.status(500).json({ message: "Credential not found" });
  }

  const keysParsing = razorpayCredentialSchema.safeParse(credential.key);
  if (!keysParsing.success) {
    log.error("verify: credential invalid", { errors: keysParsing.error.flatten() });
    return res.status(500).json({ message: "Credential invalid" });
  }

  const { key_secret } = keysParsing.data;

  const isValid = verifyPaymentSignature(
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    key_secret
  );

  if (!isValid) {
    log.warn("verify: signature mismatch", { paymentUid });
    return res.status(400).json({ message: "Invalid signature" });
  }

  // Atomically merge razorpay_payment_id into Payment.data.paymentId so refunds find the id
  const existingData = (payment.data as Record<string, unknown>) ?? {};
  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      data: {
        ...existingData,
        paymentId: razorpay_payment_id,
      } as Prisma.InputJsonValue,
    },
  });

  const traceContext: TraceContext = distributedTracing.createTrace("razorpay_verify", {
    meta: { paymentId: payment.id, bookingId: payment.bookingId },
  });

  await handlePaymentSuccessIdempotent({
    paymentId: payment.id,
    bookingId: payment.bookingId,
    appSlug: "razorpay",
    traceContext,
  });

  return res.status(200).json({ success: true, bookingUid: payment.booking?.uid });
}
