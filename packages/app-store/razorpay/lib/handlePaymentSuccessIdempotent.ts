import { handlePaymentSuccess } from "@calcom/app-store/_utils/payments/handlePaymentSuccess";
import { HttpError as HttpCode } from "@calcom/lib/http-error";
import logger from "@calcom/lib/logger";
import type { TraceContext } from "@calcom/lib/tracing";
import { prisma } from "@calcom/prisma";

const log = logger.getSubLogger({ prefix: ["razorpay:handlePaymentSuccessIdempotent"] });

export async function handlePaymentSuccessIdempotent(params: {
  paymentId: number;
  bookingId: number;
  appSlug: string;
  traceContext: TraceContext;
}): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: { id: params.paymentId },
    select: { success: true },
  });

  if (payment?.success === true) {
    log.info("Payment already marked success; skipping handlePaymentSuccess", {
      paymentId: params.paymentId,
    });
    return;
  }

  try {
    await handlePaymentSuccess(params);
  } catch (e) {
    // handlePaymentSuccess throws HttpCode(200) as its success signal
    if (e instanceof HttpCode && e.statusCode === 200) return;
    throw e;
  }
}
