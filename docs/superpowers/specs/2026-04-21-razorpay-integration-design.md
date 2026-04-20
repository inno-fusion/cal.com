# Razorpay Payment Integration — Design Spec

**Status**: Design
**Target branch**: `6.2.1` (self-hosted fork)
**Replaces**: community PR [#25345](https://github.com/calcom/cal.diy/pull/25345)
**Related analysis**: [PR_25345_RAZORPAY_ANALYSIS.md](../../../PR_25345_RAZORPAY_ANALYSIS.md)

---

## 1. Goal

Add Razorpay as a first-class payment app to Cal.com so hosts can accept paid bookings via UPI, cards, netbanking and wallets. The implementation must:

- Follow Cal.com's existing Stripe/PayPal app-store pattern.
- Correctly integrate with Cal.com's booking-confirmation pipeline (`handlePaymentSuccess`) so that paid bookings emit calendar invites, confirmation emails, `BOOKING_PAID` webhooks, and workflow triggers.
- Use Razorpay's documented idioms: raw-body webhook HMAC, SDK helpers, `X-Razorpay-Event-Id` dedup, modern order-capture syntax.
- Reuse Cal.com's native `RefundPolicy` system rather than adding a parallel one.

## 2. Scope

### In scope

- New `packages/app-store/razorpay/` app (follows Cal's existing payment app template).
- Standard Checkout modal via `checkout.razorpay.com/v1/checkout.js`.
- Auto-capture only — `paymentOption = ON_BOOKING`.
- Hybrid payment confirmation: synchronous `/verify` endpoint **and** webhook safety net. Either path calls `handlePaymentSuccess`; both are idempotent.
- Refund-on-cancellation reusing Cal.com's `RefundPolicy` enum (`NEVER | ALWAYS | DAYS`, day-level granularity).
- Webhook events handled: `order.paid`, `payment.captured`, `payment.failed`, `refund.created`, `refund.processed`, `refund.failed`, `refund.speed_changed`.
- Persistent webhook dedup via a new Prisma model keyed on the `X-Razorpay-Event-Id` header.
- Currency support: 40 currencies (Razorpay's international list minus RUB due to sanctions risk).
- Tests ported from PR #25345 (45 tests) plus new tests for the architectural changes.
- Full i18n (no hard-coded English strings).

### Out of scope

- HOLD / authorize-now-capture-later (`collectCard` / `chargeCard` throw "not supported").
- Hour-level refund granularity (Cal.com native is days-only; extending core is not justified for a fork).
- Subscriptions, payment links, invoices.
- Auto-provisioning webhook endpoints via Razorpay's API (host configures manually in the Razorpay dashboard).
- Unrelated `.env.example` / `packages/prisma/.env` changes from the original PR.

## 3. Architecture overview

```
Booker flow
───────────

[Booker books a paid event]
    │
    ▼
[Cal booking pipeline] ──> PaymentService.create()
    │                          │
    │                          ▼
    │                      razorpay.orders.create({amount, currency, receipt, notes})
    │                          │
    │                          ▼
    │                      prisma.payment.create({externalId: order.id, data: {orderId, keyId, ...}})
    │
    ▼
[Email: "Complete payment at /payment/[uid]"]
    │
    ▼
[/payment/[uid]] ── renders RazorpayPaymentComponent
    │
    ▼
[User clicks Pay] ── new Razorpay({order_id, ...}).open()
    │
    ▼
[Razorpay modal handles card/UPI/netbanking/wallet]
    │                                                        ┌────────────────────────────────┐
    ▼ (client-side handler fires)                            │ Razorpay fires webhook         │
POST /api/integrations/razorpay/verify                       │ (possibly before handler        │
    │                                                        │  returns, depending on method) │
    │  body: {order_id, payment_id, signature, paymentUid}   │                                │
    │                                                        ▼
    │ validatePaymentVerification() + timingSafeEqual      POST /api/integrations/razorpay/webhook
    │                                                        │  raw body + X-Razorpay-Signature
    │ OK → handlePaymentSuccess(paymentId, bookingId, …)     │  + X-Razorpay-Event-Id
    │         └── marks Payment.success, Booking.paid,       │
    │             sends confirmation emails, creates         │ validateWebhookSignature() +
    │             calendar events, fires BOOKING_PAID        │ timingSafeEqual
    │             webhooks + workflows                       │
    │                                                        │ Dedup via RazorpayWebhookEvent table
    │ Response {success, bookingUid}                         │
    ▼                                                        │ Respond 200 within 5s
[Redirect to /booking/[uid]]                                 │
                                                             ▼
                                                        processWebhookEvent(event)
                                                             │
                                                             ├─ order.paid / payment.captured
                                                             │      → handlePaymentSuccess (idempotent)
                                                             ├─ payment.failed → update Payment.data
                                                             ├─ refund.processed → Payment.refunded = true
                                                             ├─ refund.failed → log + update
                                                             └─ refund.created / speed_changed → log
```

```
Cancel/refund flow
──────────────────

[Booker cancels booking]
    │
    ▼
handleCancelBooking
    │
    ▼
processPaymentRefund (existing Cal.com)
    │  reads appData.refundPolicy from event-type metadata
    │
    ├─ NEVER → return
    ├─ ALWAYS → handlePaymentRefund
    └─ DAYS + refundDaysCount → check deadline → handlePaymentRefund
            │
            ▼
    PaymentService.refund(paymentId)
            │
            ▼
    razorpay.payments.refund(data.paymentId, {amount})
            │
            ▼
    Payment.refunded = true
            │
            ▼
    [Later: Razorpay fires refund.processed webhook → idempotent update]
```

## 4. File inventory

### New files

```
packages/app-store/razorpay/
├── config.json                   # regenerated via app-store-cli (canonical metadata source)
├── index.ts                      # public exports
├── package.json                  # @calcom/razorpay, deps: razorpay@^2.9.6, uuid
├── DESCRIPTION.md
├── README.md                     # Must include Razorpay trademark notice +
│                                 # link to razorpay.com/newsroom/brand-assets/
│                                 # Usage Agreement.
├── zod.ts
├── lib/
│   ├── PaymentService.ts
│   ├── RazorpayClient.ts         # thin typed wrapper around razorpay SDK
│   ├── razorpay.d.ts             # local type shim for razorpay-node
│   ├── signatures.ts             # timing-safe HMAC wrappers around SDK helpers
│   ├── constants.ts              # currencyOptions (40), notesFieldLimits
│   ├── getAppKeys.ts
│   ├── server.ts                 # RazorpayOrderData / RazorpayPaymentData DTOs
│   ├── types.ts                  # Razorpay webhook entity types (from docs)
│   ├── webhookHandler.ts         # pure async dispatcher — HTTP-layer-free, testable
│   └── __tests__/
│       ├── PaymentService.test.ts
│       └── webhookHandler.test.ts
├── api/
│   ├── index.ts
│   ├── add.ts
│   ├── verify.ts
│   ├── webhook.ts
│   └── __tests__/
│       ├── verify.test.ts
│       └── webhook.test.ts
├── components/
│   ├── EventTypeAppCardInterface.tsx
│   └── EventTypeAppSettingsInterface.tsx
├── pages/
│   └── setup/
│       └── _getServerSideProps.tsx
└── static/
    ├── icon.svg                   # OFFICIAL Razorpay brand asset, downloaded
    │                              # from https://razorpay.com/newsroom/brand-assets/
    │                              # (NOT the stylised inline SVG from PR #25345).
    │                              # Subject to Razorpay's Usage Agreement — using
    │                              # the logo to identify the Razorpay service
    │                              # inside an integration is the intended use.
    │                              # README.md must note the trademark.
    └── razorpay{1..5}.jpg         # JPEG not PNG (matches stripepayment/paypal
                                   # convention; smaller bundle).

apps/web/pages/api/integrations/razorpay/
└── webhook.ts                    # thin re-export with bodyParser:false (Stripe pattern)

apps/web/components/apps/razorpay/
├── RazorpayPaymentComponent.tsx
└── Setup.tsx

packages/prisma/migrations/<timestamp>_add_razorpay_webhook_event/
└── migration.sql
```

### Modified files

```
apps/web/app/(use-page-wrapper)/payment/[uid]/PaymentPage.tsx
    # +RazorpayPaymentComponent dynamic import, +appId === "razorpay" render branch

apps/web/components/apps/AppSetupPage.tsx
    # +razorpay: dynamic(() => import("...")) in AppSetupMap

packages/app-store/_pages/setup/_getServerSideProps.tsx
    # +razorpay: import("../../razorpay/pages/setup/_getServerSideProps") in AppSetupPageMap

packages/prisma/schema.prisma
    # +model RazorpayWebhookEvent

packages/i18n/locales/en/common.json
    # +~18 new translation keys

# Regenerated via `yarn app-store-cli build` (regenerates ALL apps' manifests;
# there is no per-app build; safe because the generator is deterministic)
packages/app-store/apps.browser.generated.tsx
packages/app-store/apps.keys-schemas.generated.ts
packages/app-store/apps.metadata.generated.ts
packages/app-store/apps.schemas.generated.ts
packages/app-store/apps.server.generated.ts
packages/app-store/bookerApps.metadata.generated.ts
packages/app-store/payment.services.generated.ts
```

## 5. Detailed design

### 5.1 Credentials

```ts
// packages/app-store/razorpay/zod.ts
export const appKeysSchema = z.object({
  key_id: z.string().min(1),
  key_secret: z.string().min(1),
  webhook_secret: z.string().optional(),
  default_currency: z.string().toLowerCase().default("inr"),
});
```

Stored in `Credential.key` JSON with `Credential.type = "razorpay_payment"`. Same pattern as Stripe; secrets are not separately encrypted beyond Cal.com's existing `Credential` protections.

**Scope decision — user-level installs only for v1.** `trpc.viewer.apps.updateAppCredentials.handler.ts:43-48` looks up credentials with `{id: credentialId, userId: user.id}` — there's no team-scoped update path. If we allowed team-level installs, rotating `key_secret` or `webhook_secret` later would require direct DB edits. For v1, pass `teamId: undefined` (equivalent to not passing it) into `createDefaultInstallation`, and document that team-wide Razorpay must wait for Cal.com to add team-credential UI. This mirrors Cal.com's organizer-level credential model that `RegularBookingService.ts:2551-2570` already assumes on the create path.

Install flow in `api/add.ts` (no leading underscore — convention across all Cal.com apps is `add.ts`; the app-store CLI's re-export uses `export { default as add } from "./add"` so an underscored filename would break key inference). Pull `appType`/`variant`/`slug` from `config.json` (same pattern as every other app — never hardcode; stays in sync with app-store-cli regenerations):

```ts
import appConfig from "../config.json";

const handler: AppDeclarativeHandler = {
  appType: appConfig.type,
  variant: appConfig.variant,
  slug: appConfig.slug,
  supportsMultipleInstalls: false,
  handlerType: "add",
  // v1: user-level install only. Do NOT forward teamId — see §5.1 scope decision.
  createCredential: ({ appType, user, slug }) =>
    createDefaultInstallation({ appType, user, slug, key: {} }),
  redirect: { newTab: false, url: "/apps/razorpay/setup" },
};
```

### 5.2 `PaymentService`

Implements `IAbstractPaymentService` from `@calcom/types/PaymentService`. Lives in `packages/app-store/razorpay/lib/PaymentService.ts`.

Method summary:

| Method | Behaviour |
|---|---|
| `constructor({key})` | Parses via `appKeysSchema`. Stores credentials or null. Does NOT instantiate Razorpay client upfront; uses lazy getter to avoid "dummy key" constructions. |
| `create(payment, bookingId, userId, username, bookerName, paymentOption, bookerEmail, bookerPhoneNumber?, eventTitle?, bookingTitle?)` | Requires `paymentOption === "ON_BOOKING"`. Builds truncated `notes` object (each value ≤ 256 chars, keys ≤ 15). Uses `receipt: "rcpt_" + bookingId + "_" + uuid-6` (semantically unique per booking, collision-resistant for retries). Calls `razorpay.orders.create({amount, currency, receipt, notes})`. **Omits `payment_capture` / `payment.capture` entirely** — razorpay-node defaults to auto-capture, which is exactly what ON_BOOKING wants. Writes `Payment` row with `externalId = order.id`, `data = {orderId, keyId, amount, currency, receipt}`, and critically `paymentOption: "ON_BOOKING"` in the Payment row. Errors thrown as `ErrorWithCode(ErrorCode.PaymentCreationFailure, "razorpay_payment_not_created")` — NOT a bare `new Error(...)`, to follow Cal.com's error-code pattern and give the booker a translatable message. On error, the Cal.com booking row still exists in pending state (no upstream rollback — matches Stripe/PayPal behaviour); see §13 risk row. |
| `collectCard()` | Throws `ErrorWithCode(ErrorCode.PaymentCreationFailure, "HOLD not supported for Razorpay")`. |
| `chargeCard()` | Same — throws not-supported. |
| `refund(paymentId)` | Loads payment. Short-circuits if already refunded. Errors if `success === false`. Calls `razorpay.payments.refund(data.paymentId, {amount: payment.amount})`. Updates `Payment.refunded = true` + `data.refundId, refundStatus, refundedAt`. Throws `ErrorWithCode` on SDK failure. |
| `afterPayment(event, booking, paymentData, eventTypeMetadata?)` | Sends "awaiting payment" email+SMS via `sendAwaitingPaymentEmailAndSMS` (which is dispatched through Cal's `tasker` as `sendAwaitingPaymentEmail` so cancel-via-`tasker.cancelWithReference` works in `handlePaymentSuccess`) with link from `createPaymentLink()`. Mirrors Stripe/PayPal exactly — call the function, don't reinvent the tasker path. |
| `deletePayment(paymentId)` | Hard delete via `prisma.payment.delete`. |
| `update` / `getPaymentPaidStatus` / `getPaymentDetails` | Not implemented — throw. (Matches Stripe.) |
| `isSetupAlready()` | `!!this.credentials`. |

The service does NOT call `handlePaymentSuccess` — that responsibility is delegated to `/verify` and the webhook handler (consistent with Stripe).

Notes truncation helper:

```ts
// lib/utils.ts
export function truncateNote(v: string, maxChars = 256): string {
  return v.length <= maxChars ? v : v.slice(0, maxChars - 1) + "…";
}
```

### 5.3 `/verify` endpoint

File: `packages/app-store/razorpay/api/verify.ts`.

```
POST /api/integrations/razorpay/verify
Content-Type: application/json

Body (zod-validated via verifyRequestSchema):
  { razorpay_payment_id, razorpay_order_id, razorpay_signature, paymentUid }
```

Flow:

1. Reject non-POST with 405.
2. `verifyRequestSchema.safeParse(req.body)`; 400 on failure.
3. Load `Payment` by `uid = paymentUid`, using `select` not `include`, pulling: `{id, bookingId, externalId, appId, booking: {uid, userId, eventType: {teamId, metadata}}}`.
4. 404 if not found.
5. 400 if `payment.externalId !== razorpay_order_id`.
6. **Resolve credential — userId-only, matching `RegularBookingService.ts:2551-2570`'s create path:**
   ```ts
   const credential = await prisma.credential.findFirst({
     where: { appId: payment.appId, userId: payment.booking?.userId },
     select: { key: true },
   });
   ```
   500 if missing. Parse via `appKeysSchema`; 500 if invalid. This is consistent across the three code paths (create / verify / webhook) and respects the v1 user-level-only scope decision in §5.1. `processPaymentRefund`'s team-or-user pattern is the outlier — Cal.com itself is inconsistent here, but we stay on the create-side pattern.
7. Verify signature via `verifyPaymentSignature(order_id, payment_id, signature, key_secret)` (our `lib/signatures.ts` wrapper — calls the SDK's `validatePaymentVerification` AND re-checks via `crypto.timingSafeEqual`). 400 on mismatch.
8. Atomically merge `razorpay_payment_id` into `Payment.data.paymentId` via `prisma.payment.update` (so refunds find the id without waiting for webhook).
9. Call `handlePaymentSuccessIdempotent({ paymentId, bookingId, appSlug: "razorpay", traceContext })` (wrapper defined below).
10. Return `{ success: true, bookingUid: payment.booking.uid }`.

#### 5.3.1 `handlePaymentSuccessIdempotent` helper

The upstream [`handlePaymentSuccess`](../../../packages/app-store/_utils/payments/handlePaymentSuccess.ts) throws `HttpCode({statusCode: 200})` at the end as its success signal, and — more importantly — is **not itself idempotent**. Re-invocation after `Booking.status === ACCEPTED` still fires `sendScheduledEmailsAndSMS` (line 265), re-queues `BOOKING_PAID` webhook subscribers (line 187-200), and re-schedules workflow triggers (line 227-234). Duplicate emails, duplicate webhook deliveries, duplicate workflow execution.

Since our architecture invokes `handlePaymentSuccess` from **both** `/verify` and the webhook, we must gate with our own idempotency wrapper. Lives in `packages/app-store/razorpay/lib/handlePaymentSuccessIdempotent.ts`:

```ts
import { HttpError as HttpCode } from "@calcom/lib/http-error";
import { handlePaymentSuccess } from "@calcom/app-store/_utils/payments/handlePaymentSuccess";
import { prisma } from "@calcom/prisma";

export async function handlePaymentSuccessIdempotent(params: {
  paymentId: number; bookingId: number; appSlug: string; traceContext: TraceContext;
}) {
  const payment = await prisma.payment.findUnique({
    where: { id: params.paymentId },
    select: { success: true },
  });
  if (payment?.success === true) {
    log.info("Payment already marked success; skipping handlePaymentSuccess", params);
    return;
  }
  try {
    await handlePaymentSuccess(params);
  } catch (e) {
    if (e instanceof HttpCode && e.statusCode === 200) return; // upstream's "success"
    throw e;
  }
}
```

The `Payment.success` gate is our idempotency token. `handlePaymentSuccess`'s inner transaction writes `Payment.success = true` atomically, so the TOCTOU window between check and action is the sub-millisecond interval where both callers could race. In that rare race both calls execute, producing duplicate emails once — acceptable for a self-hosted fork. If stricter guarantees are needed, migrate to `prisma.payment.updateMany({where:{id, success:false}, data:{success:true}})` as a pre-claim step.

#### 5.3.2 Latency note

`handlePaymentSuccess` performs external calendar API calls (`EventManager.create` iterates over destination-calendar credentials and hits Google/Office365), Cal.com webhook fan-out, and email dispatch. Typical wall-time: 2–8 seconds; can exceed 10 seconds with many calendar integrations. `/verify` blocks on this, so the booker's modal-handler `fetch` will hang accordingly. Acceptable in v1 because (a) the booker already completed payment — the "Pay" button is gone, (b) the fetch has no inherent timeout, (c) this is the same latency Stripe's `bookingSuccessRedirect` would have seen. Document in setup-page warning if measured latency is regularly > 10s.

### 5.4 Webhook endpoint

Two-file pattern matching PayPal / BTCPay / HitPay (not Stripe — Stripe re-exports from `@calcom/features/ee/payments/api/webhook`, not its own app-store dir; our pattern is the self-contained one every other payment app uses):

```ts
// apps/web/pages/api/integrations/razorpay/webhook.ts  (directory name "razorpay" must match)
export { default } from "@calcom/app-store/razorpay/api/webhook";
export const config = { api: { bodyParser: false } };
```

```ts
// packages/app-store/razorpay/api/webhook.ts
import { buffer } from "micro";
// ...full handler
```

Flow:

1. Reject non-POST with 405.
2. Read `x-razorpay-signature` (required) and `x-razorpay-event-id` (required — Razorpay's canonical idempotency key per [docs](https://razorpay.com/docs/webhooks/best-practices/)). 400 if either missing.
3. `const rawBody = (await buffer(req)).toString("utf8")`.
4. **Dedup check** (persistent): `prisma.razorpayWebhookEvent.findUnique({ where: { eventId } })`. If exists → return 200 `{received:true, duplicate:true}` without further processing.
5. Parse JSON to extract routing info (`event.event`, `event.payload.*.entity.order_id` or `payment_id`).
6. Resolve the correct `webhook_secret`. Use **userId-only lookup**, matching `/verify` (§5.3 step 6) and `RegularBookingService`'s create path:
   - If `payload.payment.entity.order_id`: look up `Payment.findFirst({where:{externalId: orderId}, select:{appId, bookingId, booking:{select:{userId}}}})`, then query `Credential` with `{appId, userId: payment.booking.userId}`.
   - If `payload.refund.entity.payment_id`: look up `Payment.findFirst({where: {data: {path:["paymentId"], equals: paymentId}}, ...})` with the same selection, same resolver.
   - If `payload.order.entity.id`: treat as orderId lookup.
   - Fallback: `process.env.RAZORPAY_WEBHOOK_SECRET`.
7. 500 if no secret resolvable.
8. `verifyWebhookSignature(rawBody, signature, webhookSecret)` via `lib/signatures.ts` (SDK helper + `timingSafeEqual`). 400 on mismatch.
9. **`await processWebhookEvent(event)`** — process inline, BEFORE inserting the dedup row. Rationale for inline-await: (a) Cal.com's Stripe webhook awaits `handlePaymentSuccess` too ([features/ee/payments/api/webhook.ts:57-62](../../../packages/features/ee/payments/api/webhook.ts)) — established pattern; (b) fire-and-forget after `res.end()` is killed by serverless runtimes; (c) if processing exceeds Razorpay's 5-second response budget, Razorpay retries — we handle that next. On error: **do not insert the dedup row**, log the error, and return a 5xx so Razorpay retries. (If the error is a bug we introduced, logs + alerts will catch it; Razorpay's 24-hour retry window gives us time to ship a fix.)
10. On success, insert the dedup row: `prisma.razorpayWebhookEvent.create({data:{eventId}})`. On unique-violation (Razorpay re-delivered while we were processing the first copy — small but possible window) treat as an already-seen event and move on. The processing itself is idempotent via `handlePaymentSuccessIdempotent` (and via idempotent DB writes for refund events), so the narrow double-processing window has no user-visible effect beyond wasted work.
11. Respond 200 `{received:true}`.

**Ordering trade-off recorded explicitly:** insert-dedup-after-success means a concurrent Razorpay retry during a slow first-invocation *can* double-process. Razorpay's retry schedule is exponential with minute-scale first backoff, so the concurrent window is narrow in practice. The alternative (insert-dedup-first, delete-on-failure) makes the "safety net on transient failures" property of the webhook hollow, since a single transient error permanently swallows the event. We choose recoverability over theoretical race-tightness.

**Serverless caveat (future consideration):** if this fork is ever deployed to Vercel / AWS Lambda, replace the inline `await processWebhookEvent` with `await tasker.create("razorpayProcessWebhookEvent", { rawBody, eventId })` and move the processor into a tasker task. See `packages/features/tasker` for the pattern. Not needed for the v1 self-hosted target.

`processWebhookEvent` (in `lib/webhookHandler.ts`, pure async function, no HTTP layer):

```
switch (event.event):
  case "order.paid":
    → loadPaymentByOrderId, call handlePaymentSuccessIdempotent
      (wrapper — no-op if Payment.success is already true)

  case "payment.captured":
    → same (safety net; order.paid is canonical). handlePaymentSuccessIdempotent
      is shared with /verify so no double-emails fire.

  case "payment.authorized":
    → info log + update data.authorizedAt; skip if already captured

  case "payment.failed":
    → update data.{errorCode, errorDescription, errorSource, errorStep, errorReason, failedAt};
      skip if payment.success === true

  case "refund.created":
    → update data.{refundId, refundStatus: "created", refundCreatedAt}

  case "refund.processed":
    → prisma.payment.update({refunded: true, data.{refundId, refundAmount, refundStatus: "processed", refundedAt}});
      skip if payment.refunded === true

  case "refund.failed":
    → update data.{refundStatus: "failed", refundFailedAt}

  case "refund.speed_changed":
    → update data.{refundSpeedProcessed}

  default:
    → info log, no-op
```

### 5.5 Client checkout component

File: `apps/web/components/apps/razorpay/RazorpayPaymentComponent.tsx`.

Key behaviour:

- Dynamically loaded from `PaymentPage.tsx` when `props.payment.appId === "razorpay"` and `!props.payment.success`.
- Injects `<script src="https://checkout.razorpay.com/v1/checkout.js">` on mount; removes on unmount.
- Payment data read via zod-validated schema `RazorpayPaymentDataSchema`: `{orderId, keyId, amount, currency}`.
- "Pay" button disabled until script loads; label is `t("razorpay_pay_amount", {amount})` using `Intl.NumberFormat` for the amount.
- On click: `new window.Razorpay(options).open()` with:
  ```ts
  {
    key: keyId,
    amount, currency, order_id: orderId,
    name: "Cal.com",
    description: t("razorpay_event_booking_payment"),
    handler: (resp) => POST /api/integrations/razorpay/verify,
    modal: { ondismiss: () => {/* no-op; server state untouched */} },
    retry: { enabled: false },
    prefill: { email, name, contact } from props.booking.attendees[0] (NOT URL query — PaymentPage's getServerSideProps does NOT append email/name to the URL; the PR's URLSearchParams read yields empty strings. contact is E.164-normalised if available; omit if missing rather than pass a malformed value which Razorpay's checkout rejects),
    theme: { color: "#292929" }
  }
  ```
- `handler` response:
  - `{success: true, bookingUid}` → `window.location.href = "/booking/" + bookingUid`.
  - any error → `window.location.reload()`. Note: on reload, Cal.com's booking pipeline sees the existing `Payment` row (`Payment.success === false`, `externalId = oldOrderId`) and will skip `PaymentService.create` (no duplicate order). The existing Razorpay order stays `created`/`attempted`; stale orders are not garbage-collected in v1 — acceptable because Razorpay does not charge for uncaptured orders. Document this behaviour; if retry-rate is high in production, add an order-cleanup job.
- `window.Razorpay` typed via ambient declaration in `packages/app-store/razorpay/lib/razorpay.d.ts`.

### 5.6 Setup page

File: `apps/web/components/apps/razorpay/Setup.tsx`.

Form fields:
- Key ID (text) — placeholder `rzp_live_xxxxxxxxxxxxx`.
- Key Secret (password, `autoComplete="new-password"`).
- Webhook Secret (password, optional).
- Default Currency (Select — full 40-currency list, i18n'd via `Intl.DisplayNames`).

Warning banner above the form:
> `t("razorpay_international_payments_warning")` — non-INR currencies require international-payments enabled on the Razorpay account.

Below the form, numbered setup instructions listing:
- Webhook URL: `` `${WEBAPP_URL}/api/integrations/razorpay/webhook` `` (import `WEBAPP_URL` from `@calcom/lib/constants` — matches the BtcPay setup pattern at [apps/web/components/apps/btcpayserver/Setup.tsx:161,246](../../../apps/web/components/apps/btcpayserver/Setup.tsx); `window.location.origin` would route webhooks to an org subdomain rather than the canonical host)
- Required events: `order.paid`, `payment.captured`, `payment.failed`, `refund.created`, `refund.processed`, `refund.failed`, `refund.speed_changed`.

Submit → `trpc.viewer.apps.updateAppCredentials.useMutation` → toast + redirect to `/event-types`.

### 5.7 Event-type app card and settings

`EventTypeAppCardInterface.tsx`: mirrors Stripe's — multi-payment-app mutual exclusion via `checkForMultiplePaymentApps`.

`EventTypeAppSettingsInterface.tsx`:
- Price (number, currency-symbol prefix via `getCurrencySymbol(locale, currency)`), converted to smallest unit via `convertToSmallestCurrencyUnit`.
- Currency (Select — full 40-currency list).
- **No payment option selector** (HOLD dropped — service only supports ON_BOOKING).
- Refund policy: reuses Cal's native `RefundPolicy` from `packages/lib/payment/types.ts`:
  - `NEVER` (default)
  - `ALWAYS`
  - `DAYS` → exposes `refundDaysCount` (number) + `refundCountCalendarDays` (checkbox).
- **`paymentOption` is fixed to `ON_BOOKING`** and stored in both the app data (via `appDataSchema`) AND written into the Payment row at `PaymentService.create` time (matches Stripe at [stripepayment/lib/PaymentService.ts:135](../../../packages/app-store/stripepayment/lib/PaymentService.ts)). `handleCancelBooking.ts:598` filters payments by `paymentOption === "ON_BOOKING"` before invoking `processPaymentRefund` — if the Payment row lacks this value, refund-on-cancellation silently skips our payments. Note: PayPal's `PaymentService.create` does NOT write this field, meaning PayPal's refund-on-cancellation path is silently broken upstream. Do NOT "align with PayPal" on this point — align with Stripe.

Because Cal.com's `processPaymentRefund` already reads `appData.refundPolicy/refundDaysCount/refundCountCalendarDays` from event-type metadata, exposing these fields in the app data is sufficient — no additional wiring needed in the cancel flow.

### 5.8 Zod schemas

```ts
// packages/app-store/razorpay/zod.ts
import { RefundPolicy } from "@calcom/lib/payment/types";

export const appKeysSchema = z.object({
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
```

### 5.9 Signature helpers

File: `packages/app-store/razorpay/lib/signatures.ts`.

Razorpay's SDK (`razorpay@^2.9.6`) is pure JavaScript with no `exports` field, so deep imports work via `moduleResolution: "node"`. The README documents the exact path: `const { validatePaymentVerification } = require("razorpay/dist/utils/razorpay-utils");`. Centralise the two imports in `signatures.ts` so any future SDK reorg surfaces in one place. If the path breaks, the fallback is to reproduce the (trivial) HMAC implementations — both helpers are just `HMAC_SHA256(payload, secret) === signature`.

```ts
import crypto from "node:crypto";
// biome-ignore lint/style/noCommonJs: razorpay-node ships no exports map and no ESM build
const { validatePaymentVerification, validateWebhookSignature } =
  require("razorpay/dist/utils/razorpay-utils") as {
    validatePaymentVerification: (params: { order_id: string; payment_id: string }, signature: string, secret: string) => boolean;
    validateWebhookSignature: (body: string, signature: string, secret: string) => boolean;
  };

export function verifyPaymentSignature(
  orderId: string, paymentId: string, signature: string, keySecret: string
): boolean {
  // Use SDK helper AND timingSafeEqual to both (a) stay consistent with Razorpay's
  // recommended path and (b) close the timing side-channel the SDK doesn't close.
  const sdkOk = validatePaymentVerification(
    { order_id: orderId, payment_id: paymentId }, signature, keySecret
  );
  if (!sdkOk) return false;
  const expected = crypto.createHmac("sha256", keySecret)
    .update(`${orderId}|${paymentId}`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function verifyWebhookSignature(
  rawBody: string, signature: string, webhookSecret: string
): boolean {
  if (!validateWebhookSignature(rawBody, signature, webhookSecret)) return false;
  const expected = crypto.createHmac("sha256", webhookSecret)
    .update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

### 5.10 `RazorpayClient` wrapper

File: `packages/app-store/razorpay/lib/RazorpayClient.ts`.

A thin typed facade over the razorpay SDK. Reasons:
- Razorpay ships no `.d.ts` files.
- Avoids `require("razorpay")` + `any` scattered across the service.
- Creates a single point to mock in tests.

```ts
import Razorpay from "razorpay";

export interface CreateOrderParams { amount: number; currency: string; receipt: string; notes?: Record<string, string>; }
export interface OrderResponse { id: string; amount: number; currency: string; receipt: string; status: string; }
export interface RefundResponse { id: string; status: "processed" | "pending" | "failed"; amount: number; speed_requested: string; speed_processed: string; }

export class RazorpayClient {
  private sdk: InstanceType<typeof Razorpay>;
  constructor(keyId: string, keySecret: string) {
    this.sdk = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }
  createOrder(params: CreateOrderParams): Promise<OrderResponse> { return this.sdk.orders.create(params) as Promise<OrderResponse>; }
  refundPayment(paymentId: string, amount: number): Promise<RefundResponse> {
    return this.sdk.payments.refund(paymentId, { amount }) as Promise<RefundResponse>;
  }
}
```

Local type shim in `lib/razorpay.d.ts` declares the `razorpay` module's surface sufficient for our usage (no `@types/razorpay` exists).

### 5.11 Data model

```prisma
// packages/prisma/schema.prisma — append
model RazorpayWebhookEvent {
  eventId    String   @id
  receivedAt DateTime @default(now())

  @@index([receivedAt])  // for future cleanup job
}
```

Two migrations (create separately so naming + intent stay clear):

**Migration A — `YYYYMMDDHHMMSS_add_razorpay_webhook_event_model`** (`yarn prisma migrate dev --name add_razorpay_webhook_event_model` emits the real UTC timestamp):

```sql
CREATE TABLE "RazorpayWebhookEvent" (
  "eventId" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RazorpayWebhookEvent_pkey" PRIMARY KEY ("eventId")
);

CREATE INDEX "RazorpayWebhookEvent_receivedAt_idx" ON "RazorpayWebhookEvent"("receivedAt");
```

**Migration B — `YYYYMMDDHHMMSS_seed_razorpay_app`** (same shape as `packages/prisma/migrations/20220525182228_cal_video_preinstalled/migration.sql`):

```sql
INSERT INTO "App" ("slug", "dirName", "categories", "keys", "createdAt", "updatedAt", "enabled")
VALUES ('razorpay', 'razorpay', '{payment}'::"AppCategories"[], '{}'::jsonb, NOW(), NOW(), true)
ON CONFLICT ("slug") DO NOTHING;
```

Rationale: `packages/app-store/_utils/handlePayment.ts:53` joins `Payment` to `App` by `dirName`, and `handleCancelBooking.ts:600` reads `successPayment.appId`. Without the `App` row, paid bookings will 500 on confirmation. Cal.com's app-store-cli **does not** write the `App` table — app-store-cli generates manifest files (TypeScript), not DB rows. `App` rows are seeded via migrations (see cal_video_preinstalled precedent) OR via the dashboard Admin UI. For a clean `yarn prisma migrate deploy` on a fresh DB, the seed migration must exist.

Estimated `RazorpayWebhookEvent` row size ~50 B. At ~10k events/year → ~500 KB/year. No cleanup job in v1; document a manual prune query for > 30-day-old rows.

## 6. Security

| Concern | Mitigation |
|---|---|
| Webhook body tampering | Raw-body HMAC via `validateWebhookSignature` + `timingSafeEqual` |
| Replay of old client-side signature | Each `Payment.uid` is single-use; `handlePaymentSuccess` short-circuits after first success. |
| Duplicate webhook deliveries | Persistent dedup on `X-Razorpay-Event-Id`. |
| Timing attack on signatures | `crypto.timingSafeEqual` on both code paths. |
| Credentials leaked to client | `Credential.key` never sent to the browser; `PaymentService.create` only surfaces `keyId` (public) and `orderId` in `payment.data`. |
| SQL-accessible sensitive fields | Prisma queries use `select` not `include`; never select `key_secret` into API responses. |
| Non-INR accounts mis-configured | Setup-page warning banner + docs link. |

## 7. Error handling

- Service layer: all errors thrown as `ErrorWithCode(ErrorCode.*, userMessage)` from `@calcom/lib/errors`.
- HTTP layer: `/verify` returns structured `{message}` JSON with appropriate status codes.
- Webhook: logs and swallows errors within `processWebhookEvent` so Razorpay receives 200 (the dedup row is persisted, so re-delivery still short-circuits; errors show up in logs for manual investigation).
- Client component: network errors from `/verify` trigger `window.location.reload()` (recoverable — user sees the Pay button again, fresh order may be required).

## 8. i18n

New keys in `packages/i18n/locales/en/common.json` (snake_case, Cal convention):

```
razorpay
razorpay_setup_key_id
razorpay_setup_key_secret
razorpay_webhook_secret_optional
razorpay_default_currency_required
razorpay_pay_amount
razorpay_event_booking_payment
razorpay_payment_data_error
razorpay_loading
razorpay_international_payments_warning
razorpay_setup_instructions_header
razorpay_setup_step_login
razorpay_setup_step_api_keys
razorpay_setup_step_generate_keys
razorpay_setup_step_webhook
razorpay_setup_step_events
razorpay_setup_step_copy_secret
razorpay_setup_step_save
razorpay_active_account_required
razorpay_api_keys_required
razorpay_webhook_recommended
razorpay_hold_not_supported
razorpay_credentials_not_found
razorpay_payment_not_created
razorpay_refund_failed
```

No English strings passed into `t()` as keys.

## 9. Testing

Port PR #25345's 45 tests, adapted to the new architecture:

| Suite | Tests | New/Changed |
|---|---|---|
| `lib/__tests__/PaymentService.test.ts` | ~12 | Replace (not adapt) the PR's HOLD tests — they're against behaviour we no longer ship. Keep: init, create success/API-error, refund short-circuits on already-refunded, delete. New: assert `collectCard`/`chargeCard` throw "not supported"; assert `create` writes `paymentOption: "ON_BOOKING"` into the Payment row. `verifyPaymentSignature` tests moved to `signatures.test.ts`. |
| `lib/__tests__/webhookHandler.test.ts` | ~14 | NEW: pure async dispatcher tests, one per event type. |
| `lib/__tests__/signatures.test.ts` | ~6 | NEW: timing-safe wrapper tests — happy, invalid, SDK-true-but-ts-false edge case. |
| `api/__tests__/verify.test.ts` | ~12 | Updates: mocks `handlePaymentSuccess` and asserts it's called on success. New test: `/verify` writes `paymentId` into `data` before calling handlePaymentSuccess. |
| `api/__tests__/webhook.test.ts` | ~15 | Updates: raw-body path, header-based dedup, DB-persisted dedup check, 200 response within budget. New test: duplicate `X-Razorpay-Event-Id` returns 200+duplicate without processing. |

Run with `TZ=UTC yarn test packages/app-store/razorpay --run`.

## 10. Third-party dependencies

- Add `razorpay@^2.9.6` to `packages/app-store/razorpay/package.json` (new workspace). Note: Razorpay's own [Node.js integration docs](https://razorpay.com/docs/payments/server-integration/nodejs/) recommend Node 22.2+, but the SDK's `package.json` has no `engines` field and works on Node 20.17 (Cal.com's current CI version) in practice. Track upstream's engines field on SDK upgrades; if they add a hard Node 22+ constraint, coordinate a Cal.com-wide Node bump before upgrading.
- Add `uuid@^9.0.0` as a local dep (already transitively available, but explicit keeps the workspace self-contained).
- No other new deps.

Lockfile regenerated via `yarn`.

## 11. Generated files

Run `yarn app-store-cli build` (the monorepo-root script `yarn app-store` maps to `yarn app-store-cli cli`, which is interactive; use `build` for non-interactive regeneration of all manifests). The generator doesn't accept a per-app filter, but it's deterministic over `config.json` + `package.json` of every app, so the diff will be scoped to razorpay-only entries as long as no other app changed since the last run.

Regenerates all seven:
- `packages/app-store/apps.browser.generated.tsx`
- `packages/app-store/apps.keys-schemas.generated.ts`
- `packages/app-store/apps.metadata.generated.ts`
- `packages/app-store/apps.schemas.generated.ts`
- `packages/app-store/apps.server.generated.ts`
- `packages/app-store/bookerApps.metadata.generated.ts`
- `packages/app-store/payment.services.generated.ts`

Do not hand-edit. On future upstream rebase, re-run `yarn app-store-cli build` to resync.

## 12. What's excluded (vs PR #25345)

| Excluded | Reason |
|---|---|
| Team-level installs | §5.1 scope decision — `updateAppCredentials` tRPC handler is user-scoped; keys can't be rotated cleanly without upstream work. Users can install Razorpay individually. |
| HOLD payment option + `collectCard`/`chargeCard` implementations | Scope decision: auto-capture only. |
| Refund policy UI's hour-level granularity | Cal.com native is day-level; extending core is non-goal for fork. |
| In-memory `Set` dedup | Broken across replicas; replaced with DB. |
| Composite `(event, created_at, account_id)` dedup key | No Razorpay uniqueness guarantee; replaced with `X-Razorpay-Event-Id`. |
| `JSON.stringify(req.body)` HMAC | Not the bytes Razorpay signed; replaced with raw buffer. |
| Hand-edited generated manifests | Regenerate via app-store-cli. |
| Hardcoded English strings | Replaced with i18n keys. |
| `.env.example` port + mailhog rewrite | Unrelated to Razorpay. |
| `packages/prisma/.env` symlink deletion | Breaks documented Windows workaround. |
| `payment_capture: 0` legacy flag | N/A — no HOLD. |
| RUB in currency list | Sanctions risk; not verified as supported by Razorpay today. |

## 13. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Webhook misconfigured in Razorpay dashboard → confirmation emails never fire | Medium | `/verify` is the primary confirmation path; webhook is safety net. Setup page lists exact events to subscribe to. |
| `handlePaymentSuccess` called twice (verify + webhook) → duplicate emails + duplicate `BOOKING_PAID` webhook deliveries + duplicate `EventManager.create` calendar writes | High (by design) | Wrapped in `handlePaymentSuccessIdempotent` (§5.3.1) which gates on `Payment.success === true`. Cal.com's upstream `handlePaymentSuccess` is NOT idempotent on its own — **every side effect** (calendar creation at L83, `BOOKING_PAID` fan-out at L187-203, workflow scheduling at L227-234, `sendScheduledEmailsAndSMS` at L265) re-fires on re-invocation. Never call it directly from our code paths. |
| Sub-millisecond race between `/verify` and webhook concurrent calls → both pass the wrapper's `success=false` check, both call `handlePaymentSuccess` → duplicate BOOKING_PAID webhooks + duplicate calendar events | Low | The wrapper's `findUnique` → call is a TOCTOU window of microseconds in the race-case where webhook lands while `/verify` is still mid-flight. Accepted for v1. Hardening path if needed: `prisma.payment.updateMany({where:{id, success:false}, data:{success:true}}) → count` as an atomic claim, then call a refactored variant of `handlePaymentSuccess` that skips its own success flag write. Not worth the refactor complexity for this fork. |
| `/verify` response latency (2–10s typical due to external calendar API calls inside `handlePaymentSuccess`) | Medium | Client's fetch has no hard timeout; booker sees "Loading…" briefly. If it exceeds 20s regularly, either (a) defer `handlePaymentSuccess` into Cal's tasker in both `/verify` and webhook paths, or (b) short-circuit `/verify` to only mark `Payment.success = true` and let the webhook run the full pipeline (accept the brief window where `/booking/[uid]` shows the pre-accept state). v1: accept the latency. |
| `razorpay-node` breaking change | Low | Pinned to `^2.9.6`; no 3.x on horizon per GitHub. Wrapper isolates API surface. |
| Cal.com core `RefundPolicy` enum changes | Low | Spec imports from single source `packages/lib/payment/types.ts`; rename is a compile-time error. |
| Dedup table grows unbounded | Low | ~500 KB/year expected; manual prune acceptable for fork. |
| Notes exceed Razorpay 256-char-per-value limit | Low | `truncateNote` helper caps each value before `orders.create`. |
| Future upstream rebase conflicts on generated files | High | Expected; re-run `yarn app-store-cli build` after rebase. |
| Razorpay API unavailable during booking → `PaymentService.create` throws → Cal.com booking persists in pending state (not rolled back by the upstream pipeline) | Low | Matches Stripe/PayPal behaviour on the same failure. Booker receives HTTP 500. Host must manually cancel the orphaned booking from the Cal.com dashboard. Document in setup instructions. Monitoring recommendation: alert on `PaymentCreationFailure` error rate > 1%. |
| `/verify` or webhook in embed mode (iframe) — Razorpay's `checkout.js` uses window-level overlays; parent `Cross-Origin-Opener-Policy` / `frame-ancestors` may block | Unknown | Not tested in v1. Document as "embed-mode Razorpay bookings not officially supported; test in your embed before enabling." |
| Team installs Razorpay but needs to rotate keys | N/A v1 | Team-level install disabled in v1 (§5.1). If a team install is needed later, add team-scoped credential update via direct DB edit or a custom tRPC mutation. |
| Monitoring gap — no alert on `/verify` latency > 20s or webhook-handler error rate | Medium | v1 ships without monitoring; add a recommendation in rollout §14 step 6 to wire Cal.com's existing log sink to observability for `razorpay-verify` and `razorpay-webhook` sub-loggers. |

## 14. Rollout plan

1. On branch `6.2.1` (current).
2. Implement per the implementation plan (to be generated via `writing-plans` skill).
3. Local smoke test with Razorpay Test Mode keys:
   a. Install app → enter test keys.
   b. Configure webhook in Razorpay dashboard (using ngrok for local testing).
   c. Enable Razorpay on a test event type, set price.
   d. Book event → pay with test card `4111 1111 1111 1111`.
   e. Verify: booking status `ACCEPTED`, confirmation email received, calendar invite created.
   f. Cancel the booking → verify `Payment.refunded = true`, refund visible in Razorpay dashboard.
   g. Simulate duplicate webhook delivery → verify dedup row, 200 response.
4. Run CI gates locally: `yarn type-check:ci --force`, `yarn biome check --write .`, `TZ=UTC yarn test`.
4a. After running `yarn app-store-cli build`, run `git diff --name-only packages/app-store/*.generated.*` and eyeball-inspect — the diff should only add `razorpay` entries. If other apps show in the diff, another in-tree change drifted the generator input; investigate before committing.
5. Commit in logical units (one prep commit + schema + service + API + UI + generated + tests).
6. Tag as `v6.2.1` for the self-hosted fork.

## 15. Known limitations (v1)

- Refund granularity: day-level only (Cal.com native).
- No HOLD / authorize-capture-later.
- No subscription, payment-links, or invoice support.
- 40 currencies (RUB excluded).
- Host must manually create the webhook endpoint in the Razorpay dashboard.
- Setup page does not auto-seed the `webhook_secret` (host copies it from Razorpay after creating the webhook).

## 16. Out-of-scope follow-ups (not in v1)

- Cleanup scheduled task for `RazorpayWebhookEvent` (> 30-day rows).
- Subscription support.
- Auto-provisioning webhook via Razorpay API.
- `HOURS` refund policy in Cal core.
- Adding RUB / 3-decimal currencies (KWD, BHD, JOD, OMR, TND).
