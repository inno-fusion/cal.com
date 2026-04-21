import crypto from "node:crypto";

const { validatePaymentVerification, validateWebhookSignature } =
  require("razorpay/dist/utils/razorpay-utils") as {
    validatePaymentVerification: (
      params: { order_id: string; payment_id: string },
      signature: string,
      secret: string
    ) => boolean;
    validateWebhookSignature: (body: string, signature: string, secret: string) => boolean;
  };

/**
 * Verifies a Razorpay payment signature using the SDK helper and an additional
 * timing-safe comparison to close the timing side-channel the SDK doesn't close.
 *
 * Returns false if the signature does not match or if buffer lengths differ
 * (timingSafeEqual throws on length mismatch, so we guard against it).
 */
export function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string,
  keySecret: string
): boolean {
  const sdkOk = validatePaymentVerification(
    { order_id: orderId, payment_id: paymentId },
    signature,
    keySecret
  );
  if (!sdkOk) return false;

  const expected = crypto.createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex");

  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);

  // timingSafeEqual throws if buffers have different lengths — guard early.
  if (expectedBuf.length !== signatureBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

/**
 * Verifies a Razorpay webhook signature using the SDK helper and an additional
 * timing-safe comparison to close the timing side-channel the SDK doesn't close.
 *
 * Returns false if the signature does not match or if buffer lengths differ.
 */
export function verifyWebhookSignature(rawBody: string, signature: string, webhookSecret: string): boolean {
  if (!validateWebhookSignature(rawBody, signature, webhookSecret)) return false;

  const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");

  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);

  // timingSafeEqual throws if buffers have different lengths — guard early.
  if (expectedBuf.length !== signatureBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}
