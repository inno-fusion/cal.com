/**
 * @vitest-environment node
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// We mock the razorpay SDK utils so the tests don't need the actual module installed
// while still exercising our timing-safe wrapper logic correctly.
vi.mock("razorpay/dist/utils/razorpay-utils", () => {
  return {
    validatePaymentVerification: (
      params: { order_id: string; payment_id: string },
      signature: string,
      secret: string
    ): boolean => {
      const expected = crypto
        .createHmac("sha256", secret)
        .update(`${params.order_id}|${params.payment_id}`)
        .digest("hex");
      return expected === signature;
    },
    validateWebhookSignature: (body: string, signature: string, secret: string): boolean => {
      const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
      return expected === signature;
    },
  };
});

import { verifyPaymentSignature, verifyWebhookSignature } from "../signatures";

function makePaymentSignature(orderId: string, paymentId: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
}

function makeWebhookSignature(rawBody: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

describe("verifyPaymentSignature", () => {
  const orderId = "order_test_abc123";
  const paymentId = "pay_test_xyz789";
  const secret = "test_key_secret_value";

  it("returns true for a valid HMAC-SHA256 signature", () => {
    const sig = makePaymentSignature(orderId, paymentId, secret);
    expect(verifyPaymentSignature(orderId, paymentId, sig, secret)).toBe(true);
  });

  it("returns false for a wrong signature", () => {
    const sig = makePaymentSignature(orderId, paymentId, secret);
    const tampered = sig.slice(0, -4) + "0000";
    expect(verifyPaymentSignature(orderId, paymentId, tampered, secret)).toBe(false);
  });

  it("returns false when the correct bytes are signed with a DIFFERENT secret", () => {
    const wrongSecret = "a_completely_different_secret";
    const sig = makePaymentSignature(orderId, paymentId, wrongSecret);
    // The signature was computed with a different secret — should fail against `secret`
    expect(verifyPaymentSignature(orderId, paymentId, sig, secret)).toBe(false);
  });

  it("returns false for a different-length signature string (guards timingSafeEqual from throw)", () => {
    // A short hex string — different length from a proper 64-char sha256 hex
    const shortSig = "deadbeef";
    expect(verifyPaymentSignature(orderId, paymentId, shortSig, secret)).toBe(false);
  });
});

describe("verifyWebhookSignature", () => {
  const secret = "webhook_secret_value_32bytes_long";
  const rawBody = JSON.stringify({ entity: "event", event: "order.paid" });

  it("returns true for a valid HMAC-SHA256 webhook signature", () => {
    const sig = makeWebhookSignature(rawBody, secret);
    expect(verifyWebhookSignature(rawBody, sig, secret)).toBe(true);
  });

  it("returns false for a wrong signature", () => {
    const sig = makeWebhookSignature(rawBody, secret);
    const tampered = sig.replace(/^.{4}/, "0000");
    expect(verifyWebhookSignature(rawBody, tampered, secret)).toBe(false);
  });

  it("returns false when signed with a DIFFERENT secret", () => {
    const wrongSecret = "another_webhook_secret_entirely";
    const sig = makeWebhookSignature(rawBody, wrongSecret);
    expect(verifyWebhookSignature(rawBody, sig, secret)).toBe(false);
  });

  it("returns false for a different-length signature string (guards timingSafeEqual from throw)", () => {
    const shortSig = "abc123";
    expect(verifyWebhookSignature(rawBody, shortSig, secret)).toBe(false);
  });
});
