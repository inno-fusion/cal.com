# PR #25345 — Razorpay Payment Integration

**Repo**: `calcom/cal.com` (URL shows `cal.diy` because that's the source fork)
**PR**: https://github.com/calcom/cal.diy/pull/25345
**Author**: @Moksh250205 (Moksh Prajapati, community contributor)
**Branch**: `feat/razorpay-payment-integration` → `main`
**State**: OPEN
**Size**: +3,259 / −7 across 44 files — label `size/XXL`
**Labels**: `community`, `Medium priority`, `❗️ .env changes`, `size/XXL`
**Commits**: 4 (`feat: Add Razorpay payment integration` + 3 follow-up fix commits for security, SSR guard/translation, and stopping tracking of `.env`)

---

## 1. What this PR does (one-liner)

Adds a new **first-class payment app** for **Razorpay** to Cal.com's app store, enabling hosts to accept bookings-for-fee via UPI, cards, net banking and wallets — targeted primarily at India / SEA users. It follows the same shape as the existing Stripe, PayPal, HitPay, BTCPay integrations in [packages/app-store/](packages/app-store/).

---

## 2. High-level architecture

A Cal.com payment app is a self-contained vertical slice inside [packages/app-store/](packages/app-store/) plus thin wiring in the web app. This PR introduces the directory [packages/app-store/razorpay/](packages/app-store/razorpay/) and registers it into the auto-generated manifest files.

```
packages/app-store/razorpay/
├── _metadata.ts              # AppMeta object (name, slug, categories, type)
├── config.json               # CLI-generated app-store manifest
├── index.ts                  # Public API of the package
├── package.json              # workspace pkg, adds dep on `razorpay@^2.9.4`, `uuid`
├── icon.svg                  # Razorpay logo
├── DESCRIPTION.md            # App store listing body + screenshot manifest
├── README.md                 # Empty (placeholder)
├── zod.ts                    # appKeysSchema, appDataSchema, webhook/verify/refund schemas
├── api/
│   ├── index.ts              # re-exports add/webhook/verify
│   ├── _add.ts               # install handler → redirects to /apps/razorpay/setup
│   ├── verify.ts             # POST /api/integrations/razorpay/verify
│   ├── webhook.ts            # POST /api/integrations/razorpay/webhook
│   └── __tests__/            # verify.test.ts (15), webhook.test.ts (14)
├── components/
│   ├── EventTypeAppCardInterface.tsx     # Toggle in event-type → Apps tab
│   └── EventTypeAppSettingsInterface.tsx # Price / currency / refund policy UI
├── lib/
│   ├── PaymentService.ts     # IAbstractPaymentService implementation (the core)
│   ├── client.ts             # createPaymentLink helper
│   ├── constants.ts          # paymentOptions, currencyOptions (41 currencies)
│   ├── getAppKeys.ts         # getRazorpayAppKeys()
│   ├── server.ts             # RazorpayOrderData/PaymentData DTO interfaces
│   ├── types.ts              # Razorpay webhook entity types
│   └── __tests__/            # paymentService.test.ts (16 tests)
├── pages/
│   └── setup/
│       └── _getServerSideProps.tsx  # Loads existing credential for setup page
└── static/
    └── razorpay1..5.png      # App store screenshots
```

Wiring outside the package:

| File | Purpose |
|---|---|
| [apps/web/app/(use-page-wrapper)/payment/\[uid\]/PaymentPage.tsx](apps/web/app/(use-page-wrapper)/payment/%5Buid%5D/PaymentPage.tsx) | Dynamically renders `<RazorpayPaymentComponent>` when `payment.appId === "razorpay"` |
| [apps/web/components/apps/AppSetupPage.tsx](apps/web/components/apps/AppSetupPage.tsx) | Registers `razorpay` in the setup-page dynamic map |
| [apps/web/components/apps/razorpay/RazorpayPaymentComponent.tsx](apps/web/components/apps/razorpay/RazorpayPaymentComponent.tsx) | Client-side checkout launcher |
| [apps/web/components/apps/razorpay/Setup.tsx](apps/web/components/apps/razorpay/Setup.tsx) | Admin setup form (API keys + currency + webhook secret) |
| [packages/app-store/apps.*.generated.*](packages/app-store/) | 7 generated manifests get a `razorpay` entry (browser, server, metadata, keys-schemas, data-schemas, bookerApps, payment.services) |
| [packages/app-store/_pages/setup/_getServerSideProps.tsx](packages/app-store/_pages/setup/_getServerSideProps.tsx) | Adds razorpay to the setup-page `_getServerSideProps` map |

> ⚠️ The auto-generated files (`apps.browser.generated.tsx`, `apps.metadata.generated.ts`, etc.) are modified **by hand** in this PR rather than regenerated via `app-store-cli`. That violates the project rule "Never modify `*.generated.ts` files directly" — reviewers will likely call this out.

---

## 3. Data model

### 3.1 Credential (`Credential.type === "razorpay_payment"`)

Stored as `Credential.key` JSON, validated by `appKeysSchema` in [packages/app-store/razorpay/zod.ts](packages/app-store/razorpay/zod.ts):

```ts
{
  key_id: string            // e.g. "rzp_live_xxx"  — required
  key_secret: string        // required, used for order creation + signature HMAC
  default_currency: string  // "inr" by default
  webhook_secret?: string   // optional; fallback is env RAZORPAY_WEBHOOK_SECRET
}
```

### 3.2 Event-type app data (`appDataSchema`)

Extends the shared `eventTypeAppCardZod` with:

```ts
{
  price: number                                   // stored in smallest currency unit (paise for INR)
  currency: string
  paymentOption?: "ON_BOOKING" | "HOLD"
  enabled?: boolean
  refundPolicy?: "NEVER" | "ALWAYS" | "DAYS"
  refundDaysCount?: number
  refundCountCalendarDays?: boolean
}
```

### 3.3 `Payment.data` JSON shape (`RazorpayPaymentStorageData`)

The existing Cal.com `Payment` row is re-used. Razorpay-specific state is serialized into the `data` JSON column. Shape from [packages/app-store/razorpay/lib/types.ts](packages/app-store/razorpay/lib/types.ts):

```ts
{
  orderId: string
  keyId?: string
  paymentId?: string
  status?: "created" | "authorized" | "captured" | "failed"
  amount?: number
  currency?: string
  receipt?: string | null
  capturedAt?: string
  authorizedAt?: string
  failedAt?: string
  errorCode?: string | null
  errorDescription?: string | null
  errorSource?: string | null
  errorStep?: string | null
  errorReason?: string | null
  refundId?: string
  refundAmount?: number
  refundStatus?: "processed" | "failed"
  refundedAt?: string
  refundFailedAt?: string
}
```

`externalId` on the `Payment` row is the Razorpay **order id** (`order_xxx`). The payment id (`pay_xxx`) lives inside `data.paymentId` once captured.

---

## 4. Core runtime: [PaymentService.ts](packages/app-store/razorpay/lib/PaymentService.ts)

Implements `IAbstractPaymentService` — the contract every Cal.com payment app must honour so that Cal's booking pipeline can stay agnostic.

Implemented methods:

| Method | Behaviour |
|---|---|
| `constructor({key})` | Parses credential via `appKeysSchema`. On failure, sets `credentials = null` but **still constructs a `Razorpay` client with dummy keys** (so the object never blows up on instantiation — all methods re-check `this.credentials`). |
| `create(payment, bookingId, userId, …, paymentOption)` | Guards `paymentOption === "ON_BOOKING"`. Calls `razorpay.orders.create({amount, currency, receipt: "rcpt_" + uuid-slice, notes: {...booking ctx}})` and writes a new `Payment` row with `externalId = order.id` and `data = {orderId, keyId, amount, currency, receipt}`. |
| `collectCard(...)` | For `paymentOption === "HOLD"`: creates an order with `payment_capture: 0` so the charge is only authorised, not captured. Writes a `Payment` row with `paymentOption: "HOLD"`. |
| `chargeCard(payment, bookingId)` | Fetches the order's payments, if one is `authorized` calls `razorpay.payments.capture(paymentId, amount, currency)`, then marks the Cal Payment row `success: true`, `data.paymentId`, `data.status = "captured"`. Errors are mapped via a small lookup (`"insufficient funds"` → `insufficient_funds`, etc.) and wrapped in `ErrorWithCode(ErrorCode.ChargeCardFailure, …)`. |
| `refund(paymentId)` | Looks up the row, short-circuits if already `refunded`, throws if not `success`. Calls `razorpay.payments.refund(data.paymentId, { amount })` then sets `refunded: true`. |
| `afterPayment(event, booking, paymentData, eventTypeMetadata)` | Sends the "awaiting payment" email + SMS via `sendAwaitingPaymentEmailAndSMS` with a payment link built by `createPaymentLink`. |
| `deletePayment(id)` | Hard `prisma.payment.delete`. |
| `update` / `getPaymentPaidStatus` / `getPaymentDetails` | Not implemented — throw. |
| `isSetupAlready()` | `!!this.credentials`. |
| `verifyPaymentSignature(orderId, paymentId, signature)` | HMAC-SHA256(`${orderId}|${paymentId}`, key_secret), constant-equality against supplied signature. |

Razorpay SDK is pulled in via `const Razorpay = require("razorpay")` (CJS interop hack inside an otherwise ESM file).

---

## 5. HTTP surface

All three endpoints sit under `/api/integrations/razorpay/*` via the generic Cal.com app-handler router.

### 5.1 `_add.ts` — install

[packages/app-store/razorpay/api/_add.ts](packages/app-store/razorpay/api/_add.ts) is a declarative `AppDeclarativeHandler`:

* `supportsMultipleInstalls: false`
* `createCredential` → `createDefaultInstallation(...)` (creates a `Credential` row with empty `key: {}`)
* Redirects user to `/apps/razorpay/setup` to enter their Razorpay keys.

### 5.2 `verify.ts` — client-side checkout verification

[packages/app-store/razorpay/api/verify.ts](packages/app-store/razorpay/api/verify.ts), called by the browser after Razorpay's checkout modal returns a `razorpay_payment_id / razorpay_order_id / razorpay_signature` triple.

Flow:

1. `POST` only; body validated by `verifyRequestSchema`.
2. Loads `Payment` by `uid` (selecting the booking's user's Razorpay credentials).
3. 404 if missing; 400 if `payment.externalId !== razorpay_order_id`.
4. 500 if the user has no Razorpay credential row.
5. If `key_secret` present, recomputes HMAC-SHA256(`order_id|payment_id`) and 400s on mismatch.
6. On success: 200 `{success: true, bookingUid}`.

> ⚠️ Weakness: verify.ts **only verifies the signature**; it does not mark the Payment row as successful or the Booking as paid. That's delegated entirely to the webhook's `payment.captured` handler. If the webhook never arrives (e.g. local dev without a public URL), the booking stays unpaid even though the user completed checkout. The UI still redirects them to `/booking/{bookingUid}`.

### 5.3 `webhook.ts` — server-to-server events

[packages/app-store/razorpay/api/webhook.ts](packages/app-store/razorpay/api/webhook.ts) handles Razorpay's webhook callbacks.

Processed events:

| Event | Handler | Side-effects |
|---|---|---|
| `payment.captured` | `handlePaymentCaptured` | Prisma transaction: `Payment.success = true` + `data.status = "captured"` + `Booking.paid = true`. Idempotent — skips if already captured. |
| `payment.authorized` | `handlePaymentAuthorized` | Updates `data.status = "authorized"`. Skips if already captured. |
| `payment.failed` | `handlePaymentFailed` | Stores `errorCode/Description/Source/Step/Reason` into `data`. Refuses to overwrite a successful payment. |
| `refund.processed` | `handleRefundProcessed` | Sets `Payment.refunded = true` and persists refund id/amount/date. |
| `refund.failed` | `handleRefundFailed` | Records `refundStatus: "failed"`. |

Signature verification:

1. Reads `x-razorpay-signature` header.
2. Walks `event.payload.payment?.entity?.order_id` → refund's `payment_id` → `order.entity.id` to pick an `orderId`.
3. Looks up `Payment` by `externalId === orderId` → pulls `Credential.key.webhook_secret`.
4. Falls back to `process.env.RAZORPAY_WEBHOOK_SECRET` if none.
5. HMAC-SHA256 of the raw `JSON.stringify(req.body)` against the secret, compared to the header.
6. Returns 400 on mismatch, 500 if no secret is configured anywhere.

De-duplication: an **in-memory `Set<string>`** (`processedWebhooks`) keyed by `${event}_${created_at}_${account_id}`, capped at 1000 entries (evicts oldest 100 when exceeded).

> ⚠️ Weaknesses:
> * The dedup cache is process-local — useless across multiple Next.js instances / serverless invocations. Razorpay retries on non-2xx within ~24h, so duplicates *will* happen in production.
> * Signature verification uses raw `===` string equality, not `crypto.timingSafeEqual`. The verify endpoint has the same issue. This is a timing-attack footgun.
> * If no credentials row can be resolved (e.g. event lookup fails before the signature check), the handler falls through to the env-var secret. An attacker who guesses an org uses the env fallback can replay against any user.
> * On raw-body serialization: Razorpay's HMAC is computed over the **exact bytes** they send. `JSON.stringify(req.body)` after Next's body parser re-serializes and may differ in key order / whitespace. Webhook signature verification in the Stripe integration uses a raw-body middleware (`micro` / `buffer`) precisely to avoid this. Likely to fail in practice for anything but the simplest payloads.

---

## 6. UI surfaces

### 6.1 [Setup.tsx](apps/web/components/apps/razorpay/Setup.tsx) — admin form

After install, the user lands on `/apps/razorpay/setup`. The page shows:

* `Razorpay Key ID*` (text)
* `Razorpay Key Secret*` (password, `autoComplete="new-password"`)
* `Webhook Secret (Optional)` (password)
* `Default Currency*` (select — hard-coded to INR/USD/EUR/GBP/AUD/CAD, **not** the full `currencyOptions` list used for event-types)
* A numbered setup guide listing the webhook URL `${origin}/api/integrations/razorpay/webhook` and the 6 events to subscribe to.

Form submit → `trpc.viewer.apps.updateAppCredentials` mutation → toast + redirect to `/event-types`.

### 6.2 [RazorpayPaymentComponent.tsx](apps/web/components/apps/razorpay/RazorpayPaymentComponent.tsx) — client checkout

Rendered when `payment.appId === "razorpay"` inside [PaymentPage.tsx](apps/web/app/(use-page-wrapper)/payment/%5Buid%5D/PaymentPage.tsx). On mount it injects `<script src="https://checkout.razorpay.com/v1/checkout.js">`, then on button click it `new window.Razorpay({ key, amount, currency, order_id, handler })` and opens the Razorpay modal. The `handler` callback POSTs to `/api/integrations/razorpay/verify` and redirects to `/booking/{bookingUid}`.

### 6.3 [EventTypeAppCardInterface.tsx](packages/app-store/razorpay/components/EventTypeAppCardInterface.tsx) + [EventTypeAppSettingsInterface.tsx](packages/app-store/razorpay/components/EventTypeAppSettingsInterface.tsx)

Shown in the event-type editor under **Apps**. Lets the host:

* Toggle Razorpay on/off (disabled if another payment app is already enabled — uses shared `checkForMultiplePaymentApps`).
* Enter price (converted to smallest-currency-unit via `convertToSmallestCurrencyUnit`).
* Pick currency from the full 41-currency `currencyOptions`.
* Pick payment option (`ON_BOOKING` / `HOLD`).
* Pick refund policy (`NEVER` / `ALWAYS` / `DAYS`), with optional `refundDaysCount` + `refundCountCalendarDays` for the `DAYS` case.

---

## 7. End-to-end booking-with-payment flow

```
1. Host installs Razorpay        → _add.ts  → creates Credential {type:"razorpay_payment", key:{}}
2. Host configures keys          → Setup.tsx → trpc updateAppCredentials → Credential.key populated
3. Host enables Razorpay on an event type + sets price/currency

— booker books —

4. Cal.com booking pipeline calls PaymentService.create(...)
   → razorpay.orders.create()                     → orderId (rzp)
   → prisma.payment.create({externalId: orderId, data:{orderId,keyId,amount,...}})
5. Cal sends "awaiting payment" email via afterPayment() with createPaymentLink()
6. Booker clicks link → /payment/{paymentUid}
   → PaymentPage.tsx renders <RazorpayPaymentComponent>
   → Razorpay checkout.js script loads, modal opens with order_id
7. Booker pays inside Razorpay modal
   → Razorpay returns {payment_id, order_id, signature} to handler
   → handler POSTs /api/integrations/razorpay/verify
   → server verifies HMAC, returns {success:true, bookingUid}
   → browser navigates to /booking/{bookingUid}
8. Simultaneously Razorpay fires webhook(s)
   → webhook.ts verifies signature
   → handlePaymentCaptured() in a prisma.$transaction:
       Payment.success = true, data.status = "captured", Booking.paid = true
9. Subsequent refund flow:
   - Host triggers via UI (not in this PR — relies on existing Cal refund hook)
     → PaymentService.refund() → razorpay.payments.refund()
   - Webhook echoes refund.processed/failed
     → handleRefundProcessed() → Payment.refunded = true
```

---

## 8. Testing

Three test files, **45 tests** total, all co-located with the code they cover:

| File | Tests | Coverage |
|---|---|---|
| [api/__tests__/verify.test.ts](packages/app-store/razorpay/api/__tests__/verify.test.ts) | 15 | method validation, zod parse, payment lookup, credential absence, signature verification happy + invalid + missing-secret paths, error paths |
| [api/__tests__/webhook.test.ts](packages/app-store/razorpay/api/__tests__/webhook.test.ts) | 14 | method, signature verification (body+secret flow, env fallback), each event type's update shape, error handling |
| [lib/__tests__/paymentService.test.ts](packages/app-store/razorpay/lib/__tests__/paymentService.test.ts) | 16 | init with valid/invalid creds, create/collectCard/chargeCard error paths, refund short-circuits, `verifyPaymentSignature` happy/invalid/missing-creds, deletePayment |

Run with `yarn test packages/app-store/razorpay --run`. All mocks use `vi.mock` against `@calcom/prisma`, `@calcom/lib/logger`, `razorpay` (the SDK), and `@calcom/emails/email-manager`.

> ⚠️ The tests don't exercise the in-memory webhook dedup cache across requests, nor do they test raw-body signature mismatch — both are the production-critical weaknesses listed above.

---

## 9. Package.json + yarn.lock changes

* Adds new workspace [packages/app-store/razorpay/package.json](packages/app-store/razorpay/package.json) (`@calcom/razorpay`).
* Introduces one new runtime dep: **`razorpay@^2.9.4`** (SDK, transitively pulls `axios@^1.6.8`).
* Adds **`uuid@^9.0.0`** as a direct dep even though many parts of the monorepo already use uuid.

This is flagged under the Cal.com rule "Ask first before adding new dependencies" — but it's the official Razorpay SDK so unlikely to be contentious.

---

## 10. Non-payment changes that leaked into the PR

These are unrelated to Razorpay and will probably be called out in review:

* **[.env.example](.env.example)**:
  * Changed `DATABASE_URL` and `DATABASE_DIRECT_URL` port from `5450` → `5433`.
  * Rewrote the mailhog / `E2E_TEST_MAILHOG_ENABLED` block — now defaults the flag **to enabled** (`E2E_TEST_MAILHOG_ENABLED=1`) and duplicates `EMAIL_FROM='noreply@localhost'`.
* **[packages/prisma/.env](packages/prisma/.env)**: symlink to `../../.env` deleted (commit 3, "chore: stop tracking .env file"). This will break the documented Windows setup workaround that commit `1c193cca86` added.
* **[yarn.lock](yarn.lock)**: Besides the expected razorpay + axios additions, there's a metadata-only rewrite of the `@calcom/ui` resolution line.

---

## 11. Code-quality observations against Cal.com standards

Flagging these against the project rules in [CLAUDE.md](CLAUDE.md) + [agents/rules/](agents/rules/) — anyone reviewing this PR should expect to land on most of these:

| # | Issue | Where | Rule |
|---|---|---|---|
| 1 | Generated files (`apps.*.generated.*`, `bookerApps.metadata.generated.ts`, `payment.services.generated.ts`) edited by hand | 7 files | "Never modify `*.generated.ts` files directly" |
| 2 | `as any` used repeatedly | webhook.ts dedup / paymentservice type casts / Select options in settings | "Never use `as any`" |
| 3 | Business logic inside API route files (webhook.ts handlers) rather than a Service | webhook.ts | Thin controllers / service layer |
| 4 | Direct Prisma usage in API routes instead of a repository | webhook.ts, verify.ts | Repository pattern |
| 5 | Raw hard-coded English strings passed to `t()` (so they appear as fallbacks rather than keys) — e.g. `t("Razorpay Key ID*")`, `t("Never refund")` | Setup.tsx, EventTypeAppSettingsInterface.tsx | Add keys to `packages/i18n/locales/en/common.json`, use snake-case keys |
| 6 | No new translation keys added to `packages/i18n/locales/en/common.json` | — | Same rule |
| 7 | In-memory webhook dedup (`processedWebhooks: Set`) not safe across serverless / multi-replica deployments | webhook.ts | Correctness |
| 8 | `JSON.stringify(req.body)` used as the HMAC input — likely differs from Razorpay's raw bytes; Stripe integration uses `micro` raw-body buffer | webhook.ts | Correctness |
| 9 | String equality for signature compare instead of `crypto.timingSafeEqual` | webhook.ts, verify.ts, PaymentService.verifyPaymentSignature | Security |
| 10 | `verify.ts` doesn't mark payment/booking as paid — sole source of truth is the webhook | verify.ts | Reliability gap if webhook misconfigured |
| 11 | `PaymentService` constructs `new Razorpay({dummy})` when credentials are missing | PaymentService.ts:35 | Noise / cleaner to early-return |
| 12 | `update`, `getPaymentPaidStatus`, `getPaymentDetails` throw "Method not implemented" | PaymentService.ts | Partial `IAbstractPaymentService` impl |
| 13 | Two parallel, overlapping setup-page components: the full `Setup.tsx` uses a 6-currency dropdown while `EventTypeAppSettingsInterface` uses the full 41-currency list | setup flow vs event-type flow | Inconsistency |
| 14 | CJS `require("razorpay")` inside an ESM file with an eslint disable comment | PaymentService.ts:2 | Avoid require in TS |
| 15 | Missing trailing newline in many files | most new files | Biome formatting |
| 16 | Secrets rotation: the `key_secret` / `webhook_secret` are read straight from `Credential.key`. Cal.com CLAUDE rules call out "Never expose `credential.key` in any query" — verify & webhook select `key` via `user.credentials` (no explicit `select: {key: true}` on the inner relation so **all fields** come back including sensitive flags). | verify.ts, webhook.ts | "Use select not include" |
| 17 | `.env`-related changes that are cosmetic-only to the unrelated mailhog section will likely trigger the `❗️ .env changes` review |  .env.example | Merge hygiene |
| 18 | PR is 3,259 lines / 44 files — triggers the Cal.com `size/XXL` label and project rule "Never create large PRs (>500 lines or >10 files) - split them instead" | entire PR | PR size guidelines |

---

## 12. TL;DR for a reviewer

- **What**: A new Razorpay payment app, feature-complete enough to take a booker through UPI/card checkout, mark the booking as paid, and process refunds — all of it handled through Razorpay-hosted checkout (no PCI scope for Cal.com).
- **Strengths**: Comprehensive 45-test suite, follows the existing Stripe/PayPal app shape, covers both `ON_BOOKING` and `HOLD` payment options, supports a refund-policy concept not present in the other payment apps.
- **Risks**: (a) webhook signature verification re-serializes the body, likely breaking in production; (b) in-memory idempotency cache won't survive horizontal scaling; (c) non-constant-time signature comparison; (d) generated-manifest files hand-edited; (e) hard-coded English strings that skip the i18n pipeline; (f) unrelated `.env.example` / `.env` symlink changes; (g) PR is XXL and should be split (at minimum: schema+service, then API, then UI).
- **Will probably merge after**: moving business logic out of the webhook handler into a Service + Repository pair, switching to `crypto.timingSafeEqual` + raw-body middleware, moving the idempotency cache to Prisma or Redis, regenerating the `apps.*.generated.*` files via `app-store-cli`, splitting into smaller PRs, and cleaning the stray `.env.example` noise.
