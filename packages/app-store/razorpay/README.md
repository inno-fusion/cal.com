# Razorpay Payment Integration for Cal.com

This app enables Cal.com hosts to accept payments via Razorpay's Standard Checkout at the time of booking. Supported payment methods include UPI, credit/debit cards, netbanking, and wallets. Bookings are automatically confirmed once payment is captured, and cancellations can trigger refunds based on configurable refund policies.

## Requirements

- A Razorpay account (sign up at [razorpay.com](https://razorpay.com))
- API keys from your Razorpay dashboard (**Settings → API Keys**)
- For currencies other than INR: international payments must be enabled on your Razorpay account

## Setup

1. Install this app from the Cal.com App Store.
2. Enter your Razorpay **Key ID** and **Key Secret**.
3. Optionally add a **Webhook Secret** (recommended for production — enables webhook-based booking confirmation as a safety net).
4. Enable Razorpay on an event type and set a price.

## Trademark Notice

Razorpay® and the Razorpay logo are trademarks of Razorpay Software Private Limited. They are used in this integration solely to identify the Razorpay service for interoperability. See <https://razorpay.com/newsroom/brand-assets/> for Razorpay's brand-asset Usage Agreement.

## Environment variables

- `RAZORPAY_WEBHOOK_SECRET` (optional) — global fallback webhook secret used only when a per-user `webhook_secret` is not configured in the app's setup form. For production Cal.com deployments that host multiple hosts, per-user `webhook_secret` values entered through the setup UI are preferred; this env var exists for single-operator deployments that do not want to re-enter the secret per user.

## Docker

Migrations run automatically on container start via `npx prisma migrate deploy` in `scripts/start.sh`. The new `RazorpayWebhookEvent` table and `App` row seed for razorpay land with the same mechanism — no manual intervention required.

## Development

```bash
# From repo root
yarn workspace @calcom/razorpay install

# Run tests
TZ=UTC yarn test packages/app-store/razorpay --run
```
