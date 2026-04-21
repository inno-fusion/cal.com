/**
 * Ambient type declarations for the `razorpay` npm package.
 * Razorpay ships no official .d.ts files; this shim covers only the surface
 * used by this integration. If the SDK adds its own types in a future release,
 * remove this file and install @types/razorpay (if published) instead.
 */

declare module "razorpay" {
  export interface RazorpayOptions {
    key_id: string;
    key_secret: string;
  }

  export interface RazorpayOrderCreateParams {
    amount: number;
    currency: string;
    receipt?: string;
    notes?: Record<string, string>;
  }

  export interface RazorpayOrder {
    id: string;
    entity: "order";
    amount: number;
    amount_paid: number;
    amount_due: number;
    currency: string;
    receipt: string | null;
    status: "created" | "attempted" | "paid";
    attempts: number;
    notes: Record<string, string>;
    created_at: number;
  }

  export interface RazorpayPayment {
    id: string;
    entity: "payment";
    amount: number;
    currency: string;
    status: "created" | "authorized" | "captured" | "refunded" | "failed";
    order_id: string;
    method: string;
    amount_refunded: number;
    captured: boolean;
    email: string;
    contact: string;
    notes: Record<string, string>;
    created_at: number;
  }

  export interface RazorpayRefundParams {
    amount?: number;
    speed?: "normal" | "optimum";
    notes?: Record<string, string>;
  }

  export interface RazorpayRefund {
    id: string;
    entity: "refund";
    amount: number;
    currency: string;
    payment_id: string;
    status: "pending" | "processed" | "failed";
    speed_processed: string;
    speed_requested: string;
    created_at: number;
  }

  export interface RazorpayOrders {
    create(params: RazorpayOrderCreateParams): Promise<RazorpayOrder>;
    fetchPayments(orderId: string): Promise<{ items: RazorpayPayment[] }>;
  }

  export interface RazorpayPayments {
    fetch(paymentId: string): Promise<RazorpayPayment>;
    refund(paymentId: string, params: RazorpayRefundParams): Promise<RazorpayRefund>;
  }

  class Razorpay {
    orders: RazorpayOrders;
    payments: RazorpayPayments;
    constructor(options: RazorpayOptions);
  }

  // razorpay-node is a CommonJS module that uses `module.exports = Razorpay`.
  // `export =` is the correct ambient form — it makes `require("razorpay")`
  // return the class itself (not a { default: ... } namespace).
  export = Razorpay;
}

// Client-side window augmentation for Razorpay Standard Checkout
interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name?: string;
  description?: string;
  handler?: (response: RazorpayCheckoutResponse) => void;
  modal?: {
    ondismiss?: () => void;
  };
  retry?: {
    enabled: boolean;
  };
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  theme?: {
    color?: string;
  };
}

interface RazorpayCheckoutResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayCheckoutInstance {
  open(): void;
}

interface RazorpayCheckoutConstructor {
  new (options: RazorpayCheckoutOptions): RazorpayCheckoutInstance;
}

declare global {
  interface Window {
    Razorpay: RazorpayCheckoutConstructor;
  }
}
