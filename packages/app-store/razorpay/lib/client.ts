import { WEBAPP_URL } from "@calcom/lib/constants";

interface CreatePaymentLinkParams {
  paymentUid: string;
  name?: string;
  email?: string;
  date?: string;
}

/**
 * Builds the URL for the Razorpay payment page for a given payment UID.
 * Used in the "awaiting payment" email sent to the booker after booking creation.
 */
export function createPaymentLink({ paymentUid }: CreatePaymentLinkParams): string {
  if (!WEBAPP_URL) {
    throw new Error("WEBAPP_URL is not configured. Cannot create payment link.");
  }
  return `${WEBAPP_URL}/payment/${paymentUid}`;
}
