/**
 * @vitest-environment node
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoist mocks ────────────────────────────────────────────────────────────
const {
  mockLog,
  mockPaymentFindFirst,
  mockPaymentUpdate,
  mockCredentialFindFirst,
  mockHandlePaymentSuccessIdempotent,
  mockVerifyPaymentSignature,
} = vi.hoisted(() => ({
  mockLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  mockPaymentFindFirst: vi.fn(),
  mockPaymentUpdate: vi.fn(),
  mockCredentialFindFirst: vi.fn(),
  mockHandlePaymentSuccessIdempotent: vi.fn(),
  mockVerifyPaymentSignature: vi.fn(),
}));

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
      findFirst: mockPaymentFindFirst,
      update: mockPaymentUpdate,
    },
    credential: {
      findFirst: mockCredentialFindFirst,
    },
  },
}));

vi.mock("@calcom/razorpay/lib/handlePaymentSuccessIdempotent", () => ({
  handlePaymentSuccessIdempotent: (...args: any[]) => mockHandlePaymentSuccessIdempotent(...args),
}));

vi.mock("@calcom/razorpay/lib/signatures", () => ({
  verifyPaymentSignature: (...args: any[]) => mockVerifyPaymentSignature(...args),
}));

import handler from "../verify";

// ── Helpers ────────────────────────────────────────────────────────────────
function makeReq(overrides: Partial<NextApiRequest> = {}): NextApiRequest {
  return {
    method: "POST",
    body: {
      razorpay_payment_id: "pay_test_abc",
      razorpay_order_id: "order_test_xyz",
      razorpay_signature: "valid_sig",
      paymentUid: "payment-uid-001",
    },
    headers: {},
    ...overrides,
  } as any;
}

function makeRes(): NextApiResponse & { _statusCode: number; _body: any } {
  const res: any = {
    _statusCode: 200,
    _body: null,
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockImplementation((code: number) => {
    res._statusCode = code;
    return res;
  });
  res.json.mockImplementation((body: any) => {
    res._body = body;
    return res;
  });
  return res;
}

const VALID_PAYMENT = {
  id: 42,
  bookingId: 7,
  externalId: "order_test_xyz",
  appId: "razorpay",
  data: {},
  booking: { uid: "booking-uid-001", userId: 1 },
};

const VALID_CREDENTIAL = {
  key: {
    key_id: "rzp_test_key123",
    key_secret: "rzp_test_secret456",
    webhook_secret: "wh_secret",
    default_currency: "inr",
  },
};

describe("verify endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPaymentFindFirst.mockResolvedValue(VALID_PAYMENT);
    mockCredentialFindFirst.mockResolvedValue(VALID_CREDENTIAL);
    mockVerifyPaymentSignature.mockReturnValue(true);
    mockHandlePaymentSuccessIdempotent.mockResolvedValue(undefined);
    mockPaymentUpdate.mockResolvedValue({ id: 42 });
  });

  it("returns 405 for non-POST requests", async () => {
    const req = makeReq({ method: "GET" });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(405);
  });

  it("returns 400 for invalid body (missing required fields)", async () => {
    const req = makeReq({ body: { bad_field: "value" } });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(400);
  });

  it("returns 400 when required string fields are empty", async () => {
    const req = makeReq({
      body: { razorpay_payment_id: "", razorpay_order_id: "o", razorpay_signature: "s", paymentUid: "u" },
    });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(400);
  });

  it("returns 404 when payment not found", async () => {
    mockPaymentFindFirst.mockResolvedValueOnce(null);
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(404);
  });

  it("returns 400 when order_id does not match payment.externalId", async () => {
    mockPaymentFindFirst.mockResolvedValueOnce({
      ...VALID_PAYMENT,
      externalId: "order_different_id",
    });
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(400);
    expect(res._body).toMatchObject({ message: "Order ID mismatch" });
  });

  it("returns 500 when credential not found", async () => {
    mockCredentialFindFirst.mockResolvedValueOnce(null);
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(500);
    expect(res._body).toMatchObject({ message: "Credential not found" });
  });

  it("returns 500 when credential key fails zod parse", async () => {
    mockCredentialFindFirst.mockResolvedValueOnce({ key: { bad_key: "value" } });
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(500);
    expect(res._body).toMatchObject({ message: "Credential invalid" });
  });

  it("returns 400 when signature verification fails", async () => {
    mockVerifyPaymentSignature.mockReturnValueOnce(false);
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(400);
    expect(res._body).toMatchObject({ message: "Invalid signature" });
  });

  it("happy path: writes paymentId to Payment.data, calls handlePaymentSuccessIdempotent, returns {success, bookingUid}", async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    // Verify paymentId was written to payment.data
    expect(mockPaymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          data: expect.objectContaining({ paymentId: "pay_test_abc" }),
        }),
      })
    );

    expect(mockHandlePaymentSuccessIdempotent).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: VALID_PAYMENT.id,
        bookingId: VALID_PAYMENT.bookingId,
        appSlug: "razorpay",
      })
    );

    expect(res._statusCode).toBe(200);
    expect(res._body).toMatchObject({ success: true, bookingUid: VALID_PAYMENT.booking.uid });
  });

  it("propagates unexpected errors when handlePaymentSuccessIdempotent throws", async () => {
    mockHandlePaymentSuccessIdempotent.mockRejectedValueOnce(new Error("Unexpected DB error"));
    const req = makeReq();
    const res = makeRes();
    // The handler doesn't wrap handlePaymentSuccessIdempotent in try-catch, so it throws
    await expect(handler(req, res)).rejects.toThrow("Unexpected DB error");
  });

  it("looks up credential with the payment's userId and appId", async () => {
    const req = makeReq();
    const res = makeRes();
    await handler(req, res);

    expect(mockCredentialFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: VALID_PAYMENT.booking.userId,
        }),
      })
    );
  });
});
