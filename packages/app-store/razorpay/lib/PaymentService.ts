import process from "node:process";
import tasker from "@calcom/features/tasker";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import logger from "@calcom/lib/logger";
import { safeStringify } from "@calcom/lib/safeStringify";
import { prisma } from "@calcom/prisma";
import type { Booking, Payment, PaymentOption, Prisma } from "@calcom/prisma/client";
import type { EventTypeMetadata } from "@calcom/prisma/zod-utils";
import type { CalendarEvent } from "@calcom/types/Calendar";
import type { IAbstractPaymentService } from "@calcom/types/PaymentService";
import { v4 as uuidv4 } from "uuid";
import { razorpayCredentialSchema } from "../zod";
import { createPaymentLink } from "./client";
import { RazorpayClient } from "./RazorpayClient";
import type { RazorpayPaymentData } from "./server";
import { truncateNote } from "./truncateNote";

const log = logger.getSubLogger({ prefix: ["payment-service:razorpay"] });

export class PaymentService implements IAbstractPaymentService {
  private credentials: ReturnType<typeof razorpayCredentialSchema.parse> | null;
  private client: RazorpayClient | null;

  constructor(credentials: { key: Prisma.JsonValue }) {
    const keyParsing = razorpayCredentialSchema.safeParse(credentials.key);
    if (keyParsing.success) {
      this.credentials = keyParsing.data;
    } else {
      this.credentials = null;
    }
    this.client = null;
  }

  private getClient(): RazorpayClient {
    if (!this.credentials) {
      throw new ErrorWithCode(ErrorCode.PaymentCreationFailure, "razorpay_credentials_not_found");
    }
    if (!this.client) {
      this.client = new RazorpayClient(this.credentials.key_id, this.credentials.key_secret);
    }
    return this.client;
  }

  async create(
    payment: Pick<Prisma.PaymentUncheckedCreateInput, "amount" | "currency">,
    bookingId: Booking["id"],
    userId: Booking["userId"],
    username: string | null,
    bookerName: string | null,
    paymentOption: PaymentOption,
    bookerEmail: string,
    bookerPhoneNumber?: string | null,
    eventTitle?: string,
    bookingTitle?: string
  ): Promise<Payment> {
    if (paymentOption !== "ON_BOOKING") {
      throw new ErrorWithCode(ErrorCode.PaymentCreationFailure, "razorpay_hold_not_supported");
    }

    if (!this.credentials) {
      throw new ErrorWithCode(ErrorCode.PaymentCreationFailure, "razorpay_credentials_not_found");
    }

    const notes: Record<string, string> = {};
    notes.bookingId = bookingId.toString();
    if (userId != null) notes.userId = userId.toString();
    if (username) notes.username = truncateNote(username);
    notes.bookerName = truncateNote(bookerName ?? "");
    notes.bookerEmail = truncateNote(bookerEmail);
    if (bookerPhoneNumber) notes.bookerPhoneNumber = truncateNote(bookerPhoneNumber);
    if (eventTitle) notes.eventTitle = truncateNote(eventTitle);
    if (bookingTitle) notes.bookingTitle = truncateNote(bookingTitle);

    const receipt = `rcpt_${bookingId}_${uuidv4().slice(0, 6)}`;

    let order: Awaited<ReturnType<RazorpayClient["createOrder"]>>;
    try {
      order = await this.getClient().createOrder({
        amount: Math.round(payment.amount),
        currency: payment.currency.toUpperCase(),
        receipt,
        notes,
      });
    } catch (e) {
      log.error("Razorpay: Payment order could not be created", bookingId, safeStringify(e));
      throw new ErrorWithCode(ErrorCode.PaymentCreationFailure, "razorpay_payment_not_created");
    }

    const paymentRow = await prisma.payment.create({
      data: {
        uid: uuidv4(),
        app: { connect: { slug: "razorpay" } },
        booking: { connect: { id: bookingId } },
        amount: payment.amount,
        currency: payment.currency,
        externalId: order.id,
        data: {
          orderId: order.id,
          keyId: this.credentials.key_id,
          amount: order.amount,
          currency: order.currency,
          receipt: order.receipt,
        } satisfies Prisma.InputJsonValue,
        fee: 0,
        refunded: false,
        success: false,
        paymentOption: paymentOption,
      },
    });

    return paymentRow;
  }

  async collectCard(
    _payment: Pick<Prisma.PaymentUncheckedCreateInput, "amount" | "currency">,
    _bookingId: Booking["id"],
    _paymentOption: PaymentOption,
    _bookerEmail: string,
    _bookerPhoneNumber?: string | null
  ): Promise<Payment> {
    throw new ErrorWithCode(ErrorCode.PaymentCreationFailure, "razorpay_hold_not_supported");
  }

  async chargeCard(
    _payment: Pick<Prisma.PaymentUncheckedCreateInput, "amount" | "currency">,
    _bookingId?: Booking["id"]
  ): Promise<Payment> {
    throw new ErrorWithCode(ErrorCode.PaymentCreationFailure, "razorpay_hold_not_supported");
  }

  async update(): Promise<Payment> {
    throw new Error("Method not implemented.");
  }

  async refund(paymentId: Payment["id"]): Promise<Payment | null> {
    try {
      const payment = await prisma.payment.findFirst({
        where: { id: paymentId },
      });

      if (!payment) return null;

      if (!payment.success) {
        throw new Error("Unable to refund failed payment");
      }

      if (payment.refunded) {
        return payment;
      }

      const data = payment.data as unknown as RazorpayPaymentData;

      if (!data.paymentId) {
        throw new Error("Payment ID not found for refund");
      }

      const refundResponse = await this.getClient().refundPayment(data.paymentId, payment.amount);

      if (refundResponse.status === "failed") {
        throw new ErrorWithCode(ErrorCode.ChargeCardFailure, "razorpay_refund_failed");
      }

      const updatedPayment = await prisma.payment.update({
        where: { id: payment.id },
        data: { refunded: true },
      });

      return updatedPayment;
    } catch (e) {
      // Log full error details BEFORE normalising — Razorpay SDK rejects with
      // plain `{statusCode, error: {code, description}}` objects that stringify
      // to `{}` with `JSON.stringify`, so use safeStringify which reaches into
      // own enumerable props. Without this log the actual reason (e.g., "The
      // payment has already been fully refunded") is lost.
      log.error(
        "Razorpay: refund failed",
        safeStringify({ paymentId, error: e, errorString: String(e) })
      );
      if (e instanceof Error) throw e;
      throw new Error(`Razorpay refund failed: ${safeStringify(e)}`);
    }
  }

  async afterPayment(
    event: CalendarEvent,
    booking: {
      user: { email: string | null; name: string | null; timeZone: string } | null;
      id: number;
      startTime: { toISOString: () => string };
      uid: string;
    },
    paymentData: Payment,
    _eventTypeMetadata?: EventTypeMetadata
  ): Promise<void> {
    const delayMinutes = Number(process.env.AWAITING_PAYMENT_EMAIL_DELAY_MINUTES) || 15;
    // give the booker time to complete payment before sending a reminder
    const scheduledEmailAt = new Date(Date.now() + delayMinutes * 60 * 1000);

    await tasker.create(
      "sendAwaitingPaymentEmail",
      {
        bookingId: booking.id,
        paymentId: paymentData.id,
        attendeeSeatId: event.attendeeSeatId || null,
      },
      {
        scheduledAt: scheduledEmailAt,
        referenceUid: booking.uid,
      }
    );
  }

  async deletePayment(paymentId: Payment["id"]): Promise<boolean> {
    try {
      const payment = await prisma.payment.findFirst({ where: { id: paymentId } });
      if (!payment) return false;

      await prisma.payment.delete({ where: { id: paymentId } });
      return true;
    } catch (e) {
      log.error("Razorpay: Unable to delete payment", paymentId, safeStringify(e));
      return false;
    }
  }

  getPaymentPaidStatus(): Promise<string> {
    throw new Error("Method not implemented.");
  }

  getPaymentDetails(): Promise<Payment> {
    throw new Error("Method not implemented.");
  }

  isSetupAlready(): boolean {
    return !!this.credentials;
  }
}

/**
 * Factory function that creates a Razorpay Payment service instance.
 * Exported instead of the class to prevent internal types from leaking into emitted .d.ts files.
 */
export function BuildPaymentService(credentials: { key: Prisma.JsonValue }): IAbstractPaymentService {
  return new PaymentService(credentials);
}
