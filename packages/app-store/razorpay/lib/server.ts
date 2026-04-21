/**
 * DTOs for data stored in the Payment.data JSON column
 * and surfaced to the client checkout component.
 */

export interface RazorpayOrderData {
  orderId: string;
  keyId: string;
  amount: number;
  currency: string;
}

export interface RazorpayPaymentData extends RazorpayOrderData {
  paymentId?: string;
  signature?: string;
}
