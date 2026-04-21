/**
 * @vitest-environment node
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoist mocks so factory closures can reference them ────────────────────
const {
  mockLog,
  mockCreateOrder,
  mockRefundPayment,
  mockPaymentCreate,
  mockPaymentFindFirst,
  mockPaymentUpdate,
  mockPaymentDelete,
  mockTaskerCreate,
} = vi.hoisted(() => {
  return {
    mockLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    mockCreateOrder: vi.fn(),
    mockRefundPayment: vi.fn(),
    mockPaymentCreate: vi.fn(),
    mockPaymentFindFirst: vi.fn(),
    mockPaymentUpdate: vi.fn(),
    mockPaymentDelete: vi.fn(),
    mockTaskerCreate: vi.fn(),
  };
});

vi.mock("@calcom/lib/logger", () => ({
  default: { getSubLogger: vi.fn(() => mockLog) },
}));

vi.mock("@calcom/lib/safeStringify", () => ({
  safeStringify: (v: any) => JSON.stringify(v),
}));

vi.mock("@calcom/features/tasker", () => ({
  default: { create: (...args: any[]) => mockTaskerCreate(...args) },
}));

vi.mock("../RazorpayClient", () => {
  return {
    RazorpayClient: class MockRazorpayClient {
      createOrder(...args: any[]) {
        return mockCreateOrder(...args);
      }
      refundPayment(...args: any[]) {
        return mockRefundPayment(...args);
      }
    },
  };
});

vi.mock("@calcom/prisma", () => ({
  prisma: {
    payment: {
      create: mockPaymentCreate,
      findFirst: mockPaymentFindFirst,
      update: mockPaymentUpdate,
      delete: mockPaymentDelete,
    },
  },
}));

vi.mock("../client", () => ({
  createPaymentLink: vi.fn(() => "https://cal.com/payment/test-uid"),
}));

import { PaymentService } from "../PaymentService";

const VALID_CREDS = {
  key: {
    key_id: "rzp_test_key123",
    key_secret: "rzp_test_secret456",
    webhook_secret: "wh_secret_abc",
    default_currency: "inr",
  },
};

const INVALID_CREDS = {
  key: { not_a_valid_field: true },
};

const MOCK_ORDER = {
  id: "order_generated_id",
  amount: 50000,
  currency: "INR",
  receipt: "rcpt_7_abc123",
  status: "created",
};

const MOCK_PAYMENT_ROW = {
  id: 99,
  uid: "payment-uid-001",
  amount: 50000,
  currency: "INR",
  externalId: MOCK_ORDER.id,
  success: false,
  refunded: false,
  paymentOption: "ON_BOOKING",
  data: {
    orderId: MOCK_ORDER.id,
    keyId: "rzp_test_key123",
    amount: MOCK_ORDER.amount,
    currency: MOCK_ORDER.currency,
    receipt: MOCK_ORDER.receipt,
  },
};

describe("PaymentService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateOrder.mockResolvedValue(MOCK_ORDER);
    mockPaymentCreate.mockResolvedValue(MOCK_PAYMENT_ROW);
    mockPaymentFindFirst.mockResolvedValue(null);
    mockPaymentUpdate.mockResolvedValue({ ...MOCK_PAYMENT_ROW, refunded: true });
    mockPaymentDelete.mockResolvedValue(MOCK_PAYMENT_ROW);
    mockTaskerCreate.mockResolvedValue(undefined);
  });

  describe("constructor / isSetupAlready", () => {
    it("isSetupAlready() returns true when credentials are valid", () => {
      const svc = new PaymentService(VALID_CREDS);
      expect(svc.isSetupAlready()).toBe(true);
    });

    it("isSetupAlready() returns false when credentials are invalid", () => {
      const svc = new PaymentService(INVALID_CREDS as any);
      expect(svc.isSetupAlready()).toBe(false);
    });
  });

  describe("create", () => {
    it("throws when paymentOption !== ON_BOOKING", async () => {
      const svc = new PaymentService(VALID_CREDS);
      await expect(
        svc.create(
          { amount: 50000, currency: "INR" },
          7,
          1,
          "username",
          "Booker Name",
          "HOLD" as any,
          "booker@example.com"
        )
      ).rejects.toMatchObject({ message: "razorpay_hold_not_supported" });
    });

    it("throws when credentials are missing", async () => {
      const svc = new PaymentService(INVALID_CREDS as any);
      await expect(
        svc.create(
          { amount: 50000, currency: "INR" },
          7,
          1,
          "username",
          "Booker Name",
          "ON_BOOKING",
          "booker@example.com"
        )
      ).rejects.toMatchObject({ message: "razorpay_credentials_not_found" });
    });

    it("happy path: calls createOrder with correct shape and writes Payment row with paymentOption:ON_BOOKING", async () => {
      const svc = new PaymentService(VALID_CREDS);
      const bookingId = 7;
      const userId = 1;

      const result = await svc.create(
        { amount: 50000, currency: "inr" },
        bookingId,
        userId,
        "john_doe",
        "John Doe",
        "ON_BOOKING",
        "john@example.com",
        "+919876543210",
        "Test Event",
        "John Doe <> Host"
      );

      expect(mockCreateOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 50000,
          currency: "INR",
          receipt: expect.stringContaining(`rcpt_${bookingId}_`),
          notes: expect.objectContaining({
            bookingId: bookingId.toString(),
            userId: userId.toString(),
            bookerEmail: "john@example.com",
            bookerName: "John Doe",
          }),
        })
      );

      expect(mockPaymentCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            externalId: MOCK_ORDER.id,
            success: false,
            refunded: false,
            paymentOption: "ON_BOOKING",
            data: expect.objectContaining({
              orderId: MOCK_ORDER.id,
              keyId: "rzp_test_key123",
            }),
          }),
        })
      );

      expect(result).toEqual(MOCK_PAYMENT_ROW);
    });

    it("throws ErrorWithCode(PaymentCreationFailure) when SDK throws", async () => {
      mockCreateOrder.mockRejectedValueOnce(new Error("Network error"));
      const svc = new PaymentService(VALID_CREDS);

      await expect(
        svc.create({ amount: 50000, currency: "INR" }, 7, 1, null, null, "ON_BOOKING", "test@example.com")
      ).rejects.toMatchObject({ message: "razorpay_payment_not_created" });
    });
  });

  describe("collectCard", () => {
    it("throws HOLD not supported error", async () => {
      const svc = new PaymentService(VALID_CREDS);
      await expect(
        svc.collectCard({ amount: 50000, currency: "INR" }, 7, "HOLD" as any, "test@example.com")
      ).rejects.toMatchObject({ message: "razorpay_hold_not_supported" });
    });
  });

  describe("chargeCard", () => {
    it("throws HOLD not supported error", async () => {
      const svc = new PaymentService(VALID_CREDS);
      await expect(svc.chargeCard({ amount: 50000, currency: "INR" }, 7)).rejects.toMatchObject({
        message: "razorpay_hold_not_supported",
      });
    });
  });

  describe("refund", () => {
    it("returns null when payment not found", async () => {
      mockPaymentFindFirst.mockResolvedValueOnce(null);
      const svc = new PaymentService(VALID_CREDS);
      const result = await svc.refund(999);
      expect(result).toBeNull();
    });

    it("throws when payment.success is false", async () => {
      mockPaymentFindFirst.mockResolvedValueOnce({
        ...MOCK_PAYMENT_ROW,
        success: false,
        data: { paymentId: "pay_xyz" },
      });
      const svc = new PaymentService(VALID_CREDS);
      await expect(svc.refund(99)).rejects.toThrow("Unable to refund failed payment");
    });

    it("returns payment unchanged when already refunded (no SDK call)", async () => {
      const alreadyRefunded = {
        ...MOCK_PAYMENT_ROW,
        success: true,
        refunded: true,
        data: { paymentId: "pay_xyz" },
      };
      mockPaymentFindFirst.mockResolvedValueOnce(alreadyRefunded);
      const svc = new PaymentService(VALID_CREDS);
      const result = await svc.refund(99);
      expect(result).toEqual(alreadyRefunded);
      expect(mockRefundPayment).not.toHaveBeenCalled();
    });

    it("happy path: calls SDK refund and sets Payment.refunded=true", async () => {
      mockPaymentFindFirst.mockResolvedValueOnce({
        ...MOCK_PAYMENT_ROW,
        success: true,
        refunded: false,
        data: { paymentId: "pay_xyz789" },
      });
      mockRefundPayment.mockResolvedValueOnce({ id: "rfnd_001", status: "processed", amount: 50000 });
      mockPaymentUpdate.mockResolvedValueOnce({ ...MOCK_PAYMENT_ROW, refunded: true });

      const svc = new PaymentService(VALID_CREDS);
      const result = await svc.refund(99);

      expect(mockRefundPayment).toHaveBeenCalledWith("pay_xyz789", 50000);
      expect(mockPaymentUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ refunded: true }) })
      );
      expect(result?.refunded).toBe(true);
    });
  });

  describe("deletePayment", () => {
    it("happy path returns true", async () => {
      mockPaymentFindFirst.mockResolvedValueOnce(MOCK_PAYMENT_ROW);
      const svc = new PaymentService(VALID_CREDS);
      const result = await svc.deletePayment(99);
      expect(result).toBe(true);
      expect(mockPaymentDelete).toHaveBeenCalled();
    });

    it("returns false when payment not found", async () => {
      mockPaymentFindFirst.mockResolvedValueOnce(null);
      const svc = new PaymentService(VALID_CREDS);
      const result = await svc.deletePayment(999);
      expect(result).toBe(false);
      expect(mockPaymentDelete).not.toHaveBeenCalled();
    });
  });
});
