export interface RazorpayPaymentEntity {
  id: string;
  entity: "payment";
  amount: number;
  currency: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  order_id: string;
  invoice_id: string | null;
  international: boolean;
  method: string;
  amount_refunded: number;
  refund_status: "null" | "partial" | "full" | null;
  captured: boolean;
  description: string | null;
  card_id: string | null;
  bank: string | null;
  wallet: string | null;
  vpa: string | null;
  email: string;
  contact: string;
  notes: Record<string, string>;
  fee: number | null;
  tax: number | null;
  error_code: string | null;
  error_description: string | null;
  error_source: string | null;
  error_step: string | null;
  error_reason: string | null;
  created_at: number;
}

export interface RazorpayRefundEntity {
  id: string;
  entity: "refund";
  amount: number;
  currency: string;
  payment_id: string;
  notes: Record<string, string>;
  receipt: string | null;
  acquirer_data: Record<string, unknown> | null;
  created_at: number;
  batch_id: string | null;
  status: "pending" | "processed" | "failed";
  speed_processed: string;
  speed_requested: string;
}

export interface RazorpayOrderEntity {
  id: string;
  entity: "order";
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string | null;
  offer_id: string | null;
  status: "created" | "attempted" | "paid";
  attempts: number;
  notes: Record<string, string>;
  created_at: number;
}

export type RazorpayWebhookEvent =
  | "order.paid"
  | "payment.captured"
  | "payment.authorized"
  | "payment.failed"
  | "refund.created"
  | "refund.processed"
  | "refund.failed"
  | "refund.speed_changed"
  | string;

export interface RazorpayWebhookPayload {
  entity: "event";
  account_id: string;
  event: RazorpayWebhookEvent;
  contains: string[];
  payload: {
    payment?: { entity: RazorpayPaymentEntity };
    refund?: { entity: RazorpayRefundEntity };
    order?: { entity: RazorpayOrderEntity };
  };
  created_at: number;
}

export interface RazorpayCredentials {
  key_id: string;
  key_secret: string;
  webhook_secret?: string;
  default_currency: string;
}

export interface RazorpayPaymentStorageData {
  orderId: string;
  keyId: string;
  amount: number;
  currency: string;
  receipt?: string;
  paymentId?: string;
  signature?: string;
  refundId?: string;
  refundStatus?: string;
  refundAmount?: number;
  refundedAt?: string;
  refundCreatedAt?: string;
  refundFailedAt?: string;
  refundSpeedProcessed?: string;
  errorCode?: string;
  errorDescription?: string;
  errorSource?: string;
  errorStep?: string;
  errorReason?: string;
  failedAt?: string;
  authorizedAt?: string;
}
