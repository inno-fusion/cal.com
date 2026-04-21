"use client";

import type { PaymentPageProps } from "@calcom/features/ee/payments/pages/payment";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Button } from "@calcom/ui/components/button";
import { Icon } from "@calcom/ui/components/icon";
import { useEffect, useState } from "react";
import z from "zod";

interface IRazorpayPaymentComponentProps {
  payment: {
    uid: string;
    data: unknown;
    amount: number;
    currency: string;
  };
  paymentPageProps: PaymentPageProps;
}

const RazorpayPaymentDataSchema = z.object({
  orderId: z.string(),
  keyId: z.string(),
  amount: z.number(),
  currency: z.string(),
});

export const RazorpayPaymentComponent = (props: IRazorpayPaymentComponentProps) => {
  const { t } = useLocale();
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [paymentError, setPaymentError] = useState(false);
  // `isVerifying` covers the window between Razorpay's handler callback firing
  // (modal closed, payment captured on Razorpay's side) and our server-side
  // /verify endpoint returning. During this window we show a "confirming…"
  // state instead of the Pay button so the booker doesn't see Pay and try to
  // click again.
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => setScriptLoaded(true);
    script.onerror = () => setPaymentError(true);
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  const parsedData = RazorpayPaymentDataSchema.safeParse(props.payment.data);

  if (!parsedData.success) {
    return (
      <div className="mt-4 flex h-full w-full flex-col items-center justify-center">
        <p className="mt-3 text-center text-red-500">{t("razorpay_payment_data_error")}</p>
      </div>
    );
  }

  const { orderId, keyId, amount, currency } = parsedData.data;

  const formattedAmount = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount / 100);

  const handlePayment = () => {
    const attendee = props.paymentPageProps.booking.attendees[0];
    // NOTE: PaymentPageProps.booking.attendees exposes only { email, name, timeZone }.
    // Phone number is not plumbed through — omit Razorpay's `contact` prefill; the
    // booker can type it inside the Razorpay modal if a UPI/netbanking method needs it.
    const prefill: Record<string, string | undefined> = {
      email: attendee?.email ?? undefined,
      name: attendee?.name ?? undefined,
    };

    // Remove undefined keys so Razorpay doesn't receive them
    Object.keys(prefill).forEach((key) => {
      if (prefill[key] === undefined) {
        delete prefill[key];
      }
    });

    const RazorpayConstructor = (
      window as unknown as { Razorpay: new (opts: unknown) => { open: () => void } }
    ).Razorpay;

    // Branding shown inside Razorpay's modal. Prefer the host/team's display
    // name; fall back to the booking title; finally "Payment" if neither is set.
    const merchantName =
      props.paymentPageProps.profile?.name ??
      props.paymentPageProps.booking?.title ??
      "Payment";
    const description =
      props.paymentPageProps.eventType?.title ??
      props.paymentPageProps.booking?.title ??
      t("razorpay_event_booking_payment");

    const rzp = new RazorpayConstructor({
      key: keyId,
      amount,
      currency: currency.toUpperCase(),
      order_id: orderId,
      name: merchantName,
      description,
      handler: async (resp: {
        razorpay_payment_id: string;
        razorpay_order_id: string;
        razorpay_signature: string;
      }) => {
        // Payment captured on Razorpay's side — modal has closed. Show the
        // verifying state immediately so the booker sees progress while the
        // server calls handlePaymentSuccess (which can take several seconds
        // due to calendar invite + email dispatch).
        setIsVerifying(true);
        try {
          const response = await fetch("/api/integrations/razorpay/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_signature: resp.razorpay_signature,
              paymentUid: props.payment.uid,
            }),
          });

          if (response.ok) {
            const result = (await response.json()) as { success: boolean; bookingUid: string };
            if (result.success && result.bookingUid) {
              window.location.href = `/booking/${result.bookingUid}`;
              return;
            }
          }
          // Fall back to reload — webhook safety net will still fire and
          // confirm the booking asynchronously. Reload clears `isVerifying`
          // and the user can retry or wait.
          window.location.reload();
        } catch {
          window.location.reload();
        }
      },
      modal: {
        ondismiss: () => {
          // User closed the Razorpay modal without completing payment.
          // Reset the verifying flag (defensive — it shouldn't be set yet).
          setIsVerifying(false);
        },
      },
      retry: { enabled: false },
      prefill,
      theme: { color: "#292929" },
    });

    rzp.open();
  };

  if (isVerifying) {
    return (
      <div className="mt-4 flex h-full w-full flex-col items-center justify-center space-y-3">
        <Icon name="loader" className="h-8 w-8 animate-spin text-default" />
        <p className="text-default text-sm font-medium">{t("razorpay_confirming_payment")}</p>
        <p className="text-subtle text-xs">{t("razorpay_do_not_close_window")}</p>
      </div>
    );
  }

  return (
    <div className="mt-4 flex h-full w-full flex-col items-center justify-center">
      <Button
        disabled={!scriptLoaded || paymentError}
        onClick={handlePayment}
        color="primary"
        className="px-8 py-2">
        {!scriptLoaded && !paymentError
          ? t("razorpay_loading")
          : t("razorpay_pay_amount", { amount: formattedAmount })}
      </Button>
    </div>
  );
};
