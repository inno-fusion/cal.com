/**
 * @vitest-environment node
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoist all mocks ────────────────────────────────────────────────────────
const {
  mockLog,
  mockBuffer,
  mockRazorpayWebhookEventFindUnique,
  mockRazorpayWebhookEventCreate,
  mockPaymentFindFirst,
  mockCredentialFindFirst,
  mockVerifyWebhookSignature,
  mockProcessWebhookEvent,
} = vi.hoisted(() => ({
  mockLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  mockBuffer: vi.fn(),
  mockRazorpayWebhookEventFindUnique: vi.fn(),
  mockRazorpayWebhookEventCreate: vi.fn(),
  mockPaymentFindFirst: vi.fn(),
  mockCredentialFindFirst: vi.fn(),
  mockVerifyWebhookSignature: vi.fn(),
  mockProcessWebhookEvent: vi.fn(),
}));

vi.mock("@calcom/lib/logger", () => ({
  default: { getSubLogger: vi.fn(() => mockLog) },
}));

vi.mock("@calcom/lib/constants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@calcom/lib/constants")>();
  return { ...actual, IS_PRODUCTION: false };
});

vi.mock("@calcom/lib/safeStringify", () => ({
  safeStringify: (v: any) => JSON.stringify(v),
}));

vi.mock("@calcom/lib/server/getServerErrorFromUnknown", () => ({
  getServerErrorFromUnknown: (e: any) => (e instanceof Error ? e : new Error(String(e))),
}));

vi.mock("micro", () => ({
  buffer: (...args: any[]) => mockBuffer(...args),
}));

vi.mock("@calcom/prisma", () => ({
  prisma: {
    razorpayWebhookEvent: {
      findUnique: mockRazorpayWebhookEventFindUnique,
      create: mockRazorpayWebhookEventCreate,
    },
    payment: { findFirst: mockPaymentFindFirst },
    credential: { findFirst: mockCredentialFindFirst },
  },
}));

vi.mock("@calcom/razorpay/lib/signatures", () => ({
  verifyWebhookSignature: (...args: any[]) => mockVerifyWebhookSignature(...args),
}));

vi.mock("@calcom/razorpay/lib/webhookHandler", () => ({
  processWebhookEvent: (...args: any[]) => mockProcessWebhookEvent(...args),
}));

import process from "node:process";
import handler from "../webhook";

// ── Constants & helpers ────────────────────────────────────────────────────
const WEBHOOK_SECRET = "test_webhook_secret_32bytes_long";
const EVENT_ID = "evt_test_001";
const ORDER_ID = "order_test_xyz";
const RAZORPAY_PAYMENT_ID = "pay_test_abc";

function makeRawBody(eventType = "order.paid", extraPayload?: object): string {
  return JSON.stringify({
    entity: "event",
    account_id: "acc_test",
    event: eventType,
    contains: ["order", "payment"],
    payload: {
      payment: { entity: { order_id: ORDER_ID, id: RAZORPAY_PAYMENT_ID } },
      order: { entity: { id: ORDER_ID } },
      ...(extraPayload ?? {}),
    },
    created_at: 1700000000,
  });
}

function makeSignature(rawBody: string, secret = WEBHOOK_SECRET): string {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

function makeReq(overrides: Partial<NextApiRequest> = {}): NextApiRequest {
  const rawBody = makeRawBody();
  return {
    method: "POST",
    headers: {
      "x-razorpay-signature": makeSignature(rawBody),
      "x-razorpay-event-id": EVENT_ID,
    },
    ...overrides,
  } as any;
}

function makeRes(): NextApiResponse & { _statusCode: number; _body: any } {
  const res: any = { _statusCode: 200, _body: null, status: vi.fn(), json: vi.fn() };
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

const MOCK_PAYMENT_WITH_CRED = { appId: "razorpay", booking: { userId: 1 } };

const MOCK_CREDENTIAL = {
  key: {
    key_id: "rzp_test_key",
    key_secret: "rzp_test_secret",
    webhook_secret: WEBHOOK_SECRET,
    default_currency: "inr",
  },
};

describe("webhook endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const rawBody = makeRawBody();
    mockBuffer.mockResolvedValue(Buffer.from(rawBody));
    mockRazorpayWebhookEventFindUnique.mockResolvedValue(null);
    mockRazorpayWebhookEventCreate.mockResolvedValue({ eventId: EVENT_ID });
    mockPaymentFindFirst.mockResolvedValue(MOCK_PAYMENT_WITH_CRED);
    mockCredentialFindFirst.mockResolvedValue(MOCK_CREDENTIAL);
    mockVerifyWebhookSignature.mockReturnValue(true);
    mockProcessWebhookEvent.mockResolvedValue(undefined);
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
  });

  // ── Method guard ───────────────────────────────────────────────────────────
  it("returns 405 for non-POST requests", async () => {
    const req = makeReq({ method: "GET" });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(405);
  });

  // ── Header guards ──────────────────────────────────────────────────────────
  it("returns 400 when x-razorpay-signature header is missing", async () => {
    const req = makeReq({ headers: { "x-razorpay-event-id": EVENT_ID } });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(400);
    expect(res._body.message).toContain("x-razorpay-signature");
  });

  it("returns 400 when x-razorpay-event-id header is missing", async () => {
    const rawBody = makeRawBody();
    const req = makeReq({ headers: { "x-razorpay-signature": makeSignature(rawBody) } });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(400);
    expect(res._body.message).toContain("x-razorpay-event-id");
  });

  it("returns 400 when signature header is an array (typeof !== string guard)", async () => {
    const rawBody = makeRawBody();
    mockBuffer.mockResolvedValue(Buffer.from(rawBody));
    const req = makeReq({
      headers: { "x-razorpay-signature": ["sig1", "sig2"] as any, "x-razorpay-event-id": EVENT_ID },
    });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(400);
  });

  it("returns 400 when event-id header is an array (typeof !== string guard)", async () => {
    const rawBody = makeRawBody();
    mockBuffer.mockResolvedValue(Buffer.from(rawBody));
    const req = makeReq({
      headers: {
        "x-razorpay-signature": makeSignature(rawBody),
        "x-razorpay-event-id": ["id1", "id2"] as any,
      },
    });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(400);
  });

  // ── Dedup ──────────────────────────────────────────────────────────────────
  it("returns 200 with duplicate:true for already-seen eventId (no processWebhookEvent)", async () => {
    mockRazorpayWebhookEventFindUnique.mockResolvedValueOnce({ eventId: EVENT_ID });
    const rawBody = makeRawBody();
    mockBuffer.mockResolvedValue(Buffer.from(rawBody));
    const req = makeReq({
      headers: { "x-razorpay-signature": makeSignature(rawBody), "x-razorpay-event-id": EVENT_ID },
    });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(200);
    expect(res._body).toMatchObject({ received: true, duplicate: true });
    expect(mockProcessWebhookEvent).not.toHaveBeenCalled();
  });

  // ── Payload validation ─────────────────────────────────────────────────────
  it("returns 500 for invalid event payload (zod fail)", async () => {
    const invalidBody = JSON.stringify({ bad: "payload" });
    mockBuffer.mockResolvedValue(Buffer.from(invalidBody));
    const req = makeReq({
      headers: { "x-razorpay-signature": makeSignature(invalidBody), "x-razorpay-event-id": EVENT_ID },
    });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(500);
    expect(res._body.message).toContain("Invalid event payload");
  });

  // ── Signature verification ─────────────────────────────────────────────────
  it("returns 400 when signature verification fails", async () => {
    mockVerifyWebhookSignature.mockReturnValueOnce(false);
    const rawBody = makeRawBody();
    mockBuffer.mockResolvedValue(Buffer.from(rawBody));
    const req = makeReq({
      headers: { "x-razorpay-signature": "bad_sig", "x-razorpay-event-id": EVENT_ID },
    });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(400);
    expect(res._body.message).toContain("Invalid signature");
  });

  // ── Webhook secret resolution ──────────────────────────────────────────────
  it("returns 500 when no webhook secret can be resolved", async () => {
    mockPaymentFindFirst.mockResolvedValue(null);
    mockCredentialFindFirst.mockResolvedValue(null);
    delete process.env.RAZORPAY_WEBHOOK_SECRET;

    const rawBody = makeRawBody();
    mockBuffer.mockResolvedValue(Buffer.from(rawBody));
    const req = makeReq({
      headers: { "x-razorpay-signature": makeSignature(rawBody), "x-razorpay-event-id": EVENT_ID },
    });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(500);
    expect(res._body.message).toContain("Webhook secret not configured");
  });

  it("uses RAZORPAY_WEBHOOK_SECRET env fallback when credential lookup fails", async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    mockPaymentFindFirst.mockResolvedValue(null);

    const rawBody = makeRawBody();
    mockBuffer.mockResolvedValue(Buffer.from(rawBody));
    const req = makeReq({
      headers: { "x-razorpay-signature": makeSignature(rawBody), "x-razorpay-event-id": EVENT_ID },
    });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(200);
    expect(res._body).toMatchObject({ received: true });
  });

  it("resolves webhook_secret from payment credential (order.paid path)", async () => {
    mockPaymentFindFirst.mockResolvedValue(MOCK_PAYMENT_WITH_CRED);
    mockCredentialFindFirst.mockResolvedValue(MOCK_CREDENTIAL);

    const rawBody = makeRawBody("order.paid");
    mockBuffer.mockResolvedValue(Buffer.from(rawBody));
    const req = makeReq({
      headers: { "x-razorpay-signature": makeSignature(rawBody), "x-razorpay-event-id": EVENT_ID },
    });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(200);
    expect(mockCredentialFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 1 }) })
    );
  });

  it("resolves webhook_secret via refund paymentId lookup", async () => {
    const refundBody = JSON.stringify({
      entity: "event",
      account_id: "acc_test",
      event: "refund.processed",
      contains: ["refund"],
      payload: {
        refund: { entity: { id: "rfnd_001", payment_id: RAZORPAY_PAYMENT_ID } },
      },
      created_at: 1700000000,
    });
    mockBuffer.mockResolvedValue(Buffer.from(refundBody));
    mockPaymentFindFirst.mockResolvedValue(MOCK_PAYMENT_WITH_CRED);
    mockCredentialFindFirst.mockResolvedValue(MOCK_CREDENTIAL);

    const req = makeReq({
      headers: { "x-razorpay-signature": makeSignature(refundBody), "x-razorpay-event-id": EVENT_ID },
    });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(200);
  });

  // ── Happy path: ordering ───────────────────────────────────────────────────
  it("calls processWebhookEvent THEN inserts dedup row THEN returns 200", async () => {
    const callOrder: string[] = [];
    mockProcessWebhookEvent.mockImplementation(async () => {
      callOrder.push("process");
    });
    mockRazorpayWebhookEventCreate.mockImplementation(async () => {
      callOrder.push("dedup-insert");
      return { eventId: EVENT_ID };
    });

    const rawBody = makeRawBody();
    mockBuffer.mockResolvedValue(Buffer.from(rawBody));
    const req = makeReq({
      headers: { "x-razorpay-signature": makeSignature(rawBody), "x-razorpay-event-id": EVENT_ID },
    });
    const res = makeRes();
    await handler(req, res);

    expect(callOrder).toEqual(["process", "dedup-insert"]);
    expect(res._statusCode).toBe(200);
    expect(res._body).toMatchObject({ received: true });
  });

  // ── processWebhookEvent failure ────────────────────────────────────────────
  it("does NOT insert dedup row and returns 500 when processWebhookEvent throws", async () => {
    mockProcessWebhookEvent.mockRejectedValueOnce(new Error("Processing failed"));

    const rawBody = makeRawBody();
    mockBuffer.mockResolvedValue(Buffer.from(rawBody));
    const req = makeReq({
      headers: { "x-razorpay-signature": makeSignature(rawBody), "x-razorpay-event-id": EVENT_ID },
    });
    const res = makeRes();
    await handler(req, res);

    expect(mockRazorpayWebhookEventCreate).not.toHaveBeenCalled();
    expect(res._statusCode).toBe(500);
  });

  // ── Race condition: P2002 dedup insert ────────────────────────────────────
  it("returns 200 when dedup insert fails with P2002 unique violation (race condition)", async () => {
    const p2002Error = Object.assign(new Error("Unique constraint violation"), { code: "P2002" });
    mockRazorpayWebhookEventCreate.mockRejectedValueOnce(p2002Error);

    const rawBody = makeRawBody();
    mockBuffer.mockResolvedValue(Buffer.from(rawBody));
    const req = makeReq({
      headers: { "x-razorpay-signature": makeSignature(rawBody), "x-razorpay-event-id": EVENT_ID },
    });
    const res = makeRes();
    await handler(req, res);

    expect(res._statusCode).toBe(200);
    expect(res._body).toMatchObject({ received: true });
  });

  // ── Header normalisation ───────────────────────────────────────────────────
  it("processes correctly when headers are standard string values", async () => {
    const rawBody = makeRawBody();
    mockBuffer.mockResolvedValue(Buffer.from(rawBody));
    const req = makeReq({
      headers: {
        "x-razorpay-signature": makeSignature(rawBody),
        "x-razorpay-event-id": EVENT_ID,
      },
    });
    const res = makeRes();
    await handler(req, res);
    expect(res._statusCode).toBe(200);
  });
});
