/**
 * @vitest-environment node
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Use vi.hoisted so mocks are available when the factory is called ────────
const {
  mockLog,
  mockPrismaPaymentFindFirst,
  mockPrismaPaymentUpdate,
  mockPrismaTransaction,
  mockHandlePaymentSuccessIdempotent,
} = vi.hoisted(() => {
  const mockLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const mockPrismaPaymentFindFirst = vi.fn();
  const mockPrismaPaymentUpdate = vi.fn();
  const mockPrismaTransaction = vi.fn();
  const mockHandlePaymentSuccessIdempotent = vi.fn();
  return {
    mockLog,
    mockPrismaPaymentFindFirst,
    mockPrismaPaymentUpdate,
    mockPrismaTransaction,
    mockHandlePaymentSuccessIdempotent,
  };
});

vi.mock("@calcom/lib/logger", () => ({
  default: { getSubLogger: vi.fn(() => mockLog) },
}));

vi.mock("@calcom/lib/tracing/factory", () => ({
  distributedTracing: {
    createTrace: vi.fn(() => ({ traceId: "t1", spanId: "s1", operation: "op" })),
  },
}));

vi.mock("@calcom/prisma", () => ({
  prisma: {
    payment: {
      findFirst: mockPrismaPaymentFindFirst,
      update: mockPrismaPaymentUpdate,
    },
    $transaction: mockPrismaTransaction,
  },
}));

vi.mock("@calcom/razorpay/lib/handlePaymentSuccessIdempotent", () => ({
  handlePaymentSuccessIdempotent: (...args: any[]) => mockHandlePaymentSuccessIdempotent(...args),
}));

import type { WebhookEvent } from "../../zod";
import { processWebhookEvent } from "../webhookHandler";

function makeEvent(eventType: string, payload: WebhookEvent["payload"] = {}): WebhookEvent {
  return {
    entity: "event",
    account_id: "acc_test",
    event: eventType,
    contains: [],
    payload,
    created_at: 1700000000,
  };
}

const ORDER_ID = "order_abc123";
const RAZORPAY_PAYMENT_ID = "pay_xyz789";
const REFUND_ID = "rfnd_qqq111";

const mockPayment = {
  id: 42,
  bookingId: 7,
  data: { orderId: ORDER_ID, keyId: "rzp_test_key" } as Record<string, unknown>,
  success: false,
  refunded: false,
};

describe("processWebhookEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHandlePaymentSuccessIdempotent.mockResolvedValue(undefined);
    mockPrismaPaymentUpdate.mockResolvedValue({ id: 42 });
    mockPrismaTransaction.mockImplementation(async (ops: any[]) => {
      for (const op of ops) {
        if (op && typeof op.then === "function") await op;
      }
      return [];
    });
  });

  describe("order.paid", () => {
    it("finds payment by orderId and calls handlePaymentSuccessIdempotent", async () => {
      mockPrismaPaymentFindFirst.mockResolvedValueOnce(mockPayment);

      await processWebhookEvent(makeEvent("order.paid", { order: { entity: { id: ORDER_ID } } }));

      expect(mockPrismaPaymentFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { externalId: ORDER_ID } })
      );
      expect(mockHandlePaymentSuccessIdempotent).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentId: mockPayment.id,
          bookingId: mockPayment.bookingId,
          appSlug: "razorpay",
        })
      );
    });

    it("logs a warning and does NOT call handlePaymentSuccessIdempotent when payment not found", async () => {
      mockPrismaPaymentFindFirst.mockResolvedValueOnce(null);

      await processWebhookEvent(makeEvent("order.paid", { order: { entity: { id: ORDER_ID } } }));

      expect(mockHandlePaymentSuccessIdempotent).not.toHaveBeenCalled();
      expect(mockLog.warn).toHaveBeenCalled();
    });

    it("does not crash and logs when order entity is missing from payload", async () => {
      await processWebhookEvent(makeEvent("order.paid", {}));
      expect(mockHandlePaymentSuccessIdempotent).not.toHaveBeenCalled();
      expect(mockLog.warn).toHaveBeenCalled();
    });
  });

  describe("payment.captured", () => {
    it("finds payment by order_id and calls handlePaymentSuccessIdempotent", async () => {
      mockPrismaPaymentFindFirst.mockResolvedValueOnce(mockPayment);

      await processWebhookEvent(
        makeEvent("payment.captured", {
          payment: { entity: { order_id: ORDER_ID, id: RAZORPAY_PAYMENT_ID } },
        })
      );

      expect(mockPrismaPaymentFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { externalId: ORDER_ID } })
      );
      expect(mockHandlePaymentSuccessIdempotent).toHaveBeenCalledWith(
        expect.objectContaining({ appSlug: "razorpay" })
      );
    });

    it("logs a warning when payment entity is missing", async () => {
      await processWebhookEvent(makeEvent("payment.captured", {}));
      expect(mockHandlePaymentSuccessIdempotent).not.toHaveBeenCalled();
      expect(mockLog.warn).toHaveBeenCalled();
    });
  });

  describe("payment.authorized", () => {
    it("updates Payment.data with status:authorized and authorizedAt", async () => {
      mockPrismaPaymentFindFirst.mockResolvedValueOnce({ ...mockPayment, data: {} });

      await processWebhookEvent(
        makeEvent("payment.authorized", {
          payment: { entity: { order_id: ORDER_ID, id: RAZORPAY_PAYMENT_ID } },
        })
      );

      expect(mockHandlePaymentSuccessIdempotent).not.toHaveBeenCalled();
      expect(mockPrismaPaymentUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            data: expect.objectContaining({ status: "authorized", authorizedAt: expect.any(String) }),
          }),
        })
      );
    });

    it("skips update if payment data already has status=captured", async () => {
      mockPrismaPaymentFindFirst.mockResolvedValueOnce({
        ...mockPayment,
        data: { status: "captured" },
      });

      await processWebhookEvent(
        makeEvent("payment.authorized", {
          payment: { entity: { order_id: ORDER_ID, id: RAZORPAY_PAYMENT_ID } },
        })
      );

      expect(mockPrismaPaymentUpdate).not.toHaveBeenCalled();
    });
  });

  describe("payment.failed", () => {
    it("updates Payment.data with error fields and failedAt", async () => {
      mockPrismaPaymentFindFirst.mockResolvedValueOnce({ ...mockPayment, success: false });

      await processWebhookEvent(
        makeEvent("payment.failed", {
          payment: {
            entity: {
              order_id: ORDER_ID,
              error_code: "BAD_REQUEST_ERROR",
              error_description: "Card declined",
              error_source: "bank",
              error_step: "payment_authorization",
              error_reason: "do_not_honor",
            },
          },
        })
      );

      expect(mockPrismaPaymentUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            data: expect.objectContaining({
              errorCode: "BAD_REQUEST_ERROR",
              errorDescription: "Card declined",
              failedAt: expect.any(String),
            }),
          }),
        })
      );
    });

    it("skips update when payment.success is already true", async () => {
      mockPrismaPaymentFindFirst.mockResolvedValueOnce({ ...mockPayment, success: true });

      await processWebhookEvent(
        makeEvent("payment.failed", {
          payment: { entity: { order_id: ORDER_ID } },
        })
      );

      expect(mockPrismaPaymentUpdate).not.toHaveBeenCalled();
    });
  });

  describe("refund.created", () => {
    it("updates Payment.data with refundId, refundStatus:created, refundCreatedAt", async () => {
      mockPrismaPaymentFindFirst.mockResolvedValueOnce({
        ...mockPayment,
        data: { paymentId: RAZORPAY_PAYMENT_ID },
      });

      await processWebhookEvent(
        makeEvent("refund.created", {
          refund: { entity: { id: REFUND_ID, payment_id: RAZORPAY_PAYMENT_ID } },
        })
      );

      expect(mockPrismaPaymentUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            data: expect.objectContaining({
              refundId: REFUND_ID,
              refundStatus: "created",
              refundCreatedAt: expect.any(String),
            }),
          }),
        })
      );
    });
  });

  describe("refund.processed", () => {
    it("sets Payment.refunded=true and updates data via transaction", async () => {
      mockPrismaPaymentFindFirst.mockResolvedValueOnce({
        ...mockPayment,
        refunded: false,
        data: { paymentId: RAZORPAY_PAYMENT_ID },
      });
      mockPrismaPaymentUpdate.mockResolvedValueOnce({ id: 42, refunded: true });

      await processWebhookEvent(
        makeEvent("refund.processed", {
          refund: { entity: { id: REFUND_ID, payment_id: RAZORPAY_PAYMENT_ID, amount: 50000 } },
        })
      );

      expect(mockPrismaTransaction).toHaveBeenCalledWith(expect.arrayContaining([expect.anything()]));
    });

    it("skips update if payment is already refunded", async () => {
      mockPrismaPaymentFindFirst.mockResolvedValueOnce({
        ...mockPayment,
        refunded: true,
        data: { paymentId: RAZORPAY_PAYMENT_ID },
      });

      await processWebhookEvent(
        makeEvent("refund.processed", {
          refund: { entity: { id: REFUND_ID, payment_id: RAZORPAY_PAYMENT_ID } },
        })
      );

      expect(mockPrismaTransaction).not.toHaveBeenCalled();
    });
  });

  describe("refund.failed", () => {
    it("updates Payment.data with refundStatus:failed and refundFailedAt", async () => {
      mockPrismaPaymentFindFirst.mockResolvedValueOnce({
        ...mockPayment,
        data: { paymentId: RAZORPAY_PAYMENT_ID },
      });

      await processWebhookEvent(
        makeEvent("refund.failed", {
          refund: { entity: { id: REFUND_ID, payment_id: RAZORPAY_PAYMENT_ID } },
        })
      );

      expect(mockPrismaPaymentUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            data: expect.objectContaining({
              refundStatus: "failed",
              refundFailedAt: expect.any(String),
            }),
          }),
        })
      );
    });
  });

  describe("refund.speed_changed", () => {
    it("updates Payment.data with refundSpeedProcessed", async () => {
      mockPrismaPaymentFindFirst.mockResolvedValueOnce({
        ...mockPayment,
        data: { paymentId: RAZORPAY_PAYMENT_ID },
      });

      await processWebhookEvent(
        makeEvent("refund.speed_changed", {
          refund: {
            entity: { id: REFUND_ID, payment_id: RAZORPAY_PAYMENT_ID, speed_processed: "instant" },
          },
        })
      );

      expect(mockPrismaPaymentUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            data: expect.objectContaining({ refundSpeedProcessed: "instant" }),
          }),
        })
      );
    });
  });

  describe("unknown event type", () => {
    it("logs info and causes no DB side-effects", async () => {
      await processWebhookEvent(makeEvent("subscription.created", {}));

      expect(mockLog.info).toHaveBeenCalled();
      expect(mockPrismaPaymentFindFirst).not.toHaveBeenCalled();
      expect(mockPrismaPaymentUpdate).not.toHaveBeenCalled();
      expect(mockHandlePaymentSuccessIdempotent).not.toHaveBeenCalled();
    });
  });

  describe("missing payload entity guards", () => {
    it("does not crash on payment.authorized with missing payment entity", async () => {
      await expect(processWebhookEvent(makeEvent("payment.authorized", {}))).resolves.toBeUndefined();
      expect(mockLog.warn).toHaveBeenCalled();
    });

    it("does not crash on payment.failed with missing payment entity", async () => {
      await expect(processWebhookEvent(makeEvent("payment.failed", {}))).resolves.toBeUndefined();
      expect(mockLog.warn).toHaveBeenCalled();
    });

    it("does not crash on refund.created with missing refund entity", async () => {
      await expect(processWebhookEvent(makeEvent("refund.created", {}))).resolves.toBeUndefined();
      expect(mockLog.warn).toHaveBeenCalled();
    });
  });
});
