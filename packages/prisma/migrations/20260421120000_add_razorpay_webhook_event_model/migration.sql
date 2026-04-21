-- CreateTable
CREATE TABLE "RazorpayWebhookEvent" (
    "eventId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RazorpayWebhookEvent_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE INDEX "RazorpayWebhookEvent_receivedAt_idx" ON "RazorpayWebhookEvent"("receivedAt");
