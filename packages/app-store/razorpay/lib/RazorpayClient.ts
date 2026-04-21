// The razorpay-node SDK ships no types and its bare-name `razorpay` collides
// with this app's own dir name in the monorepo's TS module resolution.
// Types are declared inline to avoid the ambient-module lookup entirely.

export interface CreateOrderParams {
  amount: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}

export interface OrderResponse {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
}

export interface RefundResponse {
  id: string;
  status: "processed" | "pending" | "failed";
  amount: number;
  speed_requested: string;
  speed_processed: string;
}

interface RazorpaySdkInstance {
  orders: { create(params: CreateOrderParams): Promise<OrderResponse> };
  payments: {
    refund(paymentId: string, params: { amount: number }): Promise<RefundResponse>;
  };
}

interface RazorpaySdkCtor {
  new (options: { key_id: string; key_secret: string }): RazorpaySdkInstance;
}

// Razorpay SDK rejects promises with plain `{statusCode, error: {code, description, ...}}`
// objects — NOT `Error` instances. That pattern loses every useful piece of info
// once it bubbles into a generic getErrorFromUnknown() call (which only
// stringifies Error instances). We normalise here so every throw from this
// wrapper carries a readable `message`.
export class RazorpayApiError extends Error {
  readonly statusCode: number;
  readonly razorpayCode: string;
  readonly razorpayDescription: string;
  readonly razorpaySource?: string;
  readonly razorpayStep?: string;
  readonly razorpayReason?: string;

  constructor(
    label: string,
    raw: {
      statusCode?: number;
      error?: {
        code?: string;
        description?: string;
        source?: string;
        step?: string;
        reason?: string;
      };
    }
  ) {
    const statusCode = raw.statusCode ?? 0;
    const code = raw.error?.code ?? "UNKNOWN";
    const description = raw.error?.description ?? "Razorpay API error";
    super(`Razorpay ${label} failed (status=${statusCode} code=${code}): ${description}`);
    this.name = "RazorpayApiError";
    this.statusCode = statusCode;
    this.razorpayCode = code;
    this.razorpayDescription = description;
    this.razorpaySource = raw.error?.source;
    this.razorpayStep = raw.error?.step;
    this.razorpayReason = raw.error?.reason;
  }
}

function isRazorpaySdkError(e: unknown): e is {
  statusCode?: number;
  error?: { code?: string; description?: string; source?: string; step?: string; reason?: string };
} {
  return typeof e === "object" && e !== null && "error" in (e as Record<string, unknown>);
}

async function callSdk<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Error) throw e;
    if (isRazorpaySdkError(e)) throw new RazorpayApiError(label, e);
    throw new Error(`Razorpay ${label} failed with non-standard error: ${JSON.stringify(e)}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Razorpay = require("razorpay") as RazorpaySdkCtor;

export class RazorpayClient {
  private sdk: RazorpaySdkInstance;

  constructor(keyId: string, keySecret: string) {
    this.sdk = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }

  createOrder(params: CreateOrderParams): Promise<OrderResponse> {
    return callSdk("orders.create", () => this.sdk.orders.create(params));
  }

  refundPayment(paymentId: string, amount: number): Promise<RefundResponse> {
    return callSdk("payments.refund", () => this.sdk.payments.refund(paymentId, { amount }));
  }
}
