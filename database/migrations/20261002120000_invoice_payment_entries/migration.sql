CREATE TYPE "InvoicePaymentEntryType" AS ENUM ('PAYMENT', 'REFUND');
CREATE TYPE "InvoicePaymentEntryMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'UPI', 'CARD', 'OTHER');

CREATE TABLE "invoice_payment_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "invoiceId" UUID NOT NULL,
  "idempotencyKey" UUID NOT NULL,
  "type" "InvoicePaymentEntryType" NOT NULL,
  "method" "InvoicePaymentEntryMethod" NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'INR',
  "reference" VARCHAR(120),
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "recordedById" UUID NOT NULL,
  "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_payment_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoice_payment_entries_amount_positive" CHECK ("amountMinor" > 0)
);

CREATE UNIQUE INDEX "invoice_payment_entries_invoiceId_idempotencyKey_key" ON "invoice_payment_entries"("invoiceId", "idempotencyKey");
CREATE INDEX "invoice_payment_entries_invoiceId_recordedAt_idx" ON "invoice_payment_entries"("invoiceId", "recordedAt" DESC);

ALTER TABLE "invoice_payment_entries" ADD CONSTRAINT "invoice_payment_entries_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_payment_entries" ADD CONSTRAINT "invoice_payment_entries_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
