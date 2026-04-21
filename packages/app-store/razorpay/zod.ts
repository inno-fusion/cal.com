import { eventTypeAppCardZod } from "@calcom/app-store/eventTypeAppCardZod";
import { RefundPolicy } from "@calcom/lib/payment/types";
import { z } from "zod";

// App-level schema — validated by `shouldEnableApp` via the auto-generated
// apps.keys-schemas file on container start. MUST accept an empty object
// so the App row stays `enabled: true` before any user has installed the
// app (matches PayPal's `z.object({})` pattern). Per-user credentials are
// validated via `razorpayCredentialSchema` below at the points where they
// are read (PaymentService ctor, /verify, setup page SSR, Setup form).
export const appKeysSchema = z.object({});

export const razorpayCredentialSchema = z.object({
  key_id: z.string().min(1),
  key_secret: z.string().min(1),
  webhook_secret: z.string().optional(),
  default_currency: z.string().toLowerCase().default("inr"),
});

export const appDataSchema = eventTypeAppCardZod.merge(
  z.object({
    price: z.number(),
    currency: z.string(),
    paymentOption: z.literal("ON_BOOKING").default("ON_BOOKING"),
    enabled: z.boolean().optional(),
    refundPolicy: z.nativeEnum(RefundPolicy).optional(),
    refundDaysCount: z.number().int().min(0).optional(),
    refundCountCalendarDays: z.boolean().optional(),
  })
);

export const verifyRequestSchema = z.object({
  razorpay_payment_id: z.string().min(1),
  razorpay_order_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
  paymentUid: z.string().min(1),
});

export const webhookEventSchema = z.object({
  entity: z.literal("event"),
  account_id: z.string(),
  event: z.string(),
  contains: z.array(z.string()),
  payload: z.object({
    payment: z.object({ entity: z.any() }).optional(),
    refund: z.object({ entity: z.any() }).optional(),
    order: z.object({ entity: z.any() }).optional(),
  }),
  created_at: z.number(),
});

export type AppKeys = z.infer<typeof appKeysSchema>;
export type RazorpayCredential = z.infer<typeof razorpayCredentialSchema>;
export type RazorpayData = z.infer<typeof appDataSchema>;
export type WebhookEvent = z.infer<typeof webhookEventSchema>;
export type VerifyRequest = z.infer<typeof verifyRequestSchema>;
