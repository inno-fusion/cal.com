import logger from "@calcom/lib/logger";
import type { TraceContext } from "@calcom/lib/tracing";
import { distributedTracing } from "@calcom/lib/tracing/factory";
import { prisma } from "@calcom/prisma";
import type { WebhookEvent } from "../zod";
import { handlePaymentSuccessIdempotent } from "./handlePaymentSuccessIdempotent";

const log = logger.getSubLogger({ prefix: ["razorpay-webhook-handler"] });

async function loadPaymentByOrderId(orderId: string) {
  return prisma.payment.findFirst({
    where: { externalId: orderId },
    select: { id: true, bookingId: true, data: true, success: true, refunded: true },
  });
}

async function loadPaymentByPaymentId(razorpayPaymentId: string) {
  return prisma.payment.findFirst({
    where: { data: { path: ["paymentId"], equals: razorpayPaymentId } },
    select: { id: true, bookingId: true, data: true, success: true, refunded: true },
  });
}

async function handleOrderPaid(orderEntity: { id: string }) {
  const payment = await loadPaymentByOrderId(orderEntity.id);
  if (!payment) {
    log.warn("order.paid: payment not found", { orderId: orderEntity.id });
    return;
  }

  const traceContext: TraceContext = distributedTracing.createTrace("razorpay_webhook_order_paid", {
    meta: { paymentId: payment.id, bookingId: payment.bookingId },
  });

  await handlePaymentSuccessIdempotent({
    paymentId: payment.id,
    bookingId: payment.bookingId,
    appSlug: "razorpay",
    traceContext,
  });
}

async function handleOrderPaidFromPayment(paymentEntity: { order_id: string }) {
  const payment = await loadPaymentByOrderId(paymentEntity.order_id);
  if (!payment) {
    log.warn("payment.captured: payment not found by order_id", { orderId: paymentEntity.order_id });
    return;
  }

  const traceContext: TraceContext = distributedTracing.createTrace("razorpay_webhook_payment_captured", {
    meta: { paymentId: payment.id, bookingId: payment.bookingId },
  });

  await handlePaymentSuccessIdempotent({
    paymentId: payment.id,
    bookingId: payment.bookingId,
    appSlug: "razorpay",
    traceContext,
  });
}

export async function processWebhookEvent(event: WebhookEvent): Promise<void> {
  switch (event.event) {
    case "order.paid": {
      const orderEntity = event.payload.order?.entity as { id: string } | undefined;
      if (!orderEntity) {
        log.warn("order.paid: missing order entity");
        return;
      }
      await handleOrderPaid(orderEntity);
      break;
    }

    case "payment.captured": {
      const paymentEntity = event.payload.payment?.entity as { order_id: string } | undefined;
      if (!paymentEntity) {
        log.warn("payment.captured: missing payment entity");
        return;
      }
      await handleOrderPaidFromPayment(paymentEntity);
      break;
    }

    case "payment.authorized": {
      const paymentEntity = event.payload.payment?.entity as
        | { order_id: string; id: string; created_at?: number; status?: string }
        | undefined;
      if (!paymentEntity) {
        log.warn("payment.authorized: missing payment entity");
        return;
      }
      log.info("payment.authorized received", { orderId: paymentEntity.order_id });

      const payment = await loadPaymentByOrderId(paymentEntity.order_id);
      if (!payment) {
        log.warn("payment.authorized: payment not found", { orderId: paymentEntity.order_id });
        return;
      }

      const existingData = (payment.data as Record<string, unknown>) ?? {};
      // Skip if already captured to avoid overwriting with stale data
      if (existingData.status === "captured") break;

      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          data: {
            ...existingData,
            authorizedAt: new Date().toISOString(),
            status: "authorized",
          },
        },
      });
      break;
    }

    case "payment.failed": {
      const paymentEntity = event.payload.payment?.entity as
        | {
            order_id: string;
            error_code?: string | null;
            error_description?: string | null;
            error_source?: string | null;
            error_step?: string | null;
            error_reason?: string | null;
          }
        | undefined;
      if (!paymentEntity) {
        log.warn("payment.failed: missing payment entity");
        return;
      }

      const payment = await loadPaymentByOrderId(paymentEntity.order_id);
      if (!payment) {
        log.warn("payment.failed: payment not found", { orderId: paymentEntity.order_id });
        return;
      }

      // Skip update if payment was already successfully confirmed
      if (payment.success === true) break;

      const existingData = (payment.data as Record<string, unknown>) ?? {};
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          data: {
            ...existingData,
            errorCode: paymentEntity.error_code ?? null,
            errorDescription: paymentEntity.error_description ?? null,
            errorSource: paymentEntity.error_source ?? null,
            errorStep: paymentEntity.error_step ?? null,
            errorReason: paymentEntity.error_reason ?? null,
            failedAt: new Date().toISOString(),
          },
        },
      });
      break;
    }

    case "refund.created": {
      const refundEntity = event.payload.refund?.entity as { id: string; payment_id: string } | undefined;
      if (!refundEntity) {
        log.warn("refund.created: missing refund entity");
        return;
      }

      const payment = await loadPaymentByPaymentId(refundEntity.payment_id);
      if (!payment) {
        log.warn("refund.created: payment not found", { paymentId: refundEntity.payment_id });
        return;
      }

      const existingData = (payment.data as Record<string, unknown>) ?? {};
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          data: {
            ...existingData,
            refundId: refundEntity.id,
            refundStatus: "created",
            refundCreatedAt: new Date().toISOString(),
          },
        },
      });
      break;
    }

    case "refund.processed": {
      const refundEntity = event.payload.refund?.entity as
        | { id: string; payment_id: string; amount?: number }
        | undefined;
      if (!refundEntity) {
        log.warn("refund.processed: missing refund entity");
        return;
      }

      const payment = await loadPaymentByPaymentId(refundEntity.payment_id);
      if (!payment) {
        log.warn("refund.processed: payment not found", { paymentId: refundEntity.payment_id });
        return;
      }

      // Idempotent — skip if already refunded
      if (payment.refunded === true) break;

      const existingData = (payment.data as Record<string, unknown>) ?? {};
      await prisma.$transaction([
        prisma.payment.update({
          where: { id: payment.id },
          data: {
            refunded: true,
            data: {
              ...existingData,
              refundId: refundEntity.id,
              refundAmount: refundEntity.amount,
              refundStatus: "processed",
              refundedAt: new Date().toISOString(),
            },
          },
        }),
      ]);
      break;
    }

    case "refund.failed": {
      const refundEntity = event.payload.refund?.entity as { id: string; payment_id: string } | undefined;
      if (!refundEntity) {
        log.warn("refund.failed: missing refund entity");
        return;
      }

      const payment = await loadPaymentByPaymentId(refundEntity.payment_id);
      if (!payment) {
        log.warn("refund.failed: payment not found", { paymentId: refundEntity.payment_id });
        return;
      }

      const existingData = (payment.data as Record<string, unknown>) ?? {};
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          data: {
            ...existingData,
            refundStatus: "failed",
            refundFailedAt: new Date().toISOString(),
          },
        },
      });
      break;
    }

    case "refund.speed_changed": {
      const refundEntity = event.payload.refund?.entity as
        | { id: string; payment_id: string; speed_processed?: string }
        | undefined;
      if (!refundEntity) {
        log.warn("refund.speed_changed: missing refund entity");
        return;
      }

      const payment = await loadPaymentByPaymentId(refundEntity.payment_id);
      if (!payment) {
        log.warn("refund.speed_changed: payment not found", { paymentId: refundEntity.payment_id });
        return;
      }

      const existingData = (payment.data as Record<string, unknown>) ?? {};
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          data: {
            ...existingData,
            refundSpeedProcessed: refundEntity.speed_processed ?? null,
          },
        },
      });
      break;
    }

    default:
      log.info("Unhandled Razorpay webhook event", { eventType: event.event });
      break;
  }
}
