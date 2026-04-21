---
items:
  - razorpay1.png
  - razorpay2.png
  - razorpay3.png
  - razorpay4.png
  - razorpay5.png
---

## Razorpay — Accept payments via UPI, Cards, and Netbanking

Razorpay is India's leading payment gateway, trusted by over 8 million businesses. With this integration, hosts can require payment at the time of booking and accept money via any method their customers prefer — no checkout page redirect required.

### Features

- **UPI, Cards, Netbanking, and Wallets** — Razorpay's Standard Checkout modal supports virtually every Indian and international payment method in one flow.
- **40 currencies** — Accept payments in INR and 39 international currencies (requires international payments to be enabled on your Razorpay account).
- **Automatic booking confirmation** — Once payment is captured, Cal.com automatically confirms the booking, sends confirmation emails, creates calendar events, and fires any configured webhooks and workflows.
- **Refund on cancellation** — Configure a refund policy (Never, Always, or within N days) on a per-event-type basis. Cancellations within the policy window trigger an automatic refund via the Razorpay API.
- **Webhook safety net** — A secondary webhook path ensures bookings are confirmed even if the browser closes before the payment handler fires.
- **Idempotent processing** — Duplicate webhook deliveries are deduplicated via Razorpay's `X-Razorpay-Event-Id` header, so your bookers never receive duplicate confirmation emails.

### Setup

1. Create a Razorpay account at [razorpay.com](https://razorpay.com).
2. Generate API keys from **Settings → API Keys** in the Razorpay dashboard.
3. Install this app and enter your Key ID and Key Secret.
4. Create a webhook endpoint in the Razorpay dashboard pointing to your Cal.com webhook URL, and paste the webhook secret into the setup form.
5. Enable Razorpay on any event type and set a price.

### Trademark Notice

Razorpay® and the Razorpay logo are trademarks of Razorpay Software Private Limited. They are used in this integration solely to identify the Razorpay service for interoperability purposes.
