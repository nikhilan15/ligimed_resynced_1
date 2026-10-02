CREATE TYPE "InvoiceType" AS ENUM ('RETAIL_SALE', 'DEALER_PURCHASE');

CREATE TABLE "invoices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "pharmacyOrganizationId" UUID NOT NULL,
  "type" "InvoiceType" NOT NULL,
  "referenceNumber" VARCHAR(100) NOT NULL,
  "idempotencyKey" UUID,
  "counterpartyName" VARCHAR(250) NOT NULL,
  "customerId" UUID,
  "dealerOrganizationId" UUID,
  "orderId" UUID,
  "externalIssuedAt" DATE,
  "currency" CHAR(3) NOT NULL DEFAULT 'INR',
  "subtotalMinor" BIGINT NOT NULL,
  "taxMinor" BIGINT NOT NULL,
  "deliveryChargeMinor" BIGINT NOT NULL DEFAULT 0,
  "totalMinor" BIGINT NOT NULL,
  "recordedById" UUID NOT NULL,
  "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoice_type_relations" CHECK (
    ("type" = 'RETAIL_SALE' AND "customerId" IS NOT NULL AND "dealerOrganizationId" IS NULL AND "orderId" IS NULL AND "externalIssuedAt" IS NULL)
    OR ("type" = 'DEALER_PURCHASE' AND "customerId" IS NULL AND "dealerOrganizationId" IS NOT NULL AND "orderId" IS NOT NULL AND "externalIssuedAt" IS NOT NULL)
  ),
  CONSTRAINT "invoice_amounts_nonnegative" CHECK (
    "subtotalMinor" >= 0 AND "taxMinor" >= 0 AND "deliveryChargeMinor" >= 0
    AND "totalMinor" = "subtotalMinor" + "taxMinor" + "deliveryChargeMinor"
  )
);

CREATE TABLE "invoice_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "invoiceId" UUID NOT NULL,
  "inventoryBatchId" UUID NOT NULL,
  "stockMovementId" UUID NOT NULL,
  "productName" VARCHAR(250) NOT NULL,
  "batchNumber" VARCHAR(100) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitPriceMinor" BIGINT NOT NULL,
  "subtotalMinor" BIGINT NOT NULL,
  "taxMinor" BIGINT NOT NULL,
  "lineTotalMinor" BIGINT NOT NULL,
  CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoice_line_values_valid" CHECK (
    "quantity" > 0 AND "unitPriceMinor" >= 0 AND "taxMinor" >= 0
    AND "subtotalMinor" = "unitPriceMinor" * "quantity"
    AND "lineTotalMinor" = "subtotalMinor" + "taxMinor"
  )
);

CREATE INDEX "invoices_pharmacyOrganizationId_type_referenceNumber_idx" ON "invoices"("pharmacyOrganizationId", "type", "referenceNumber");
CREATE UNIQUE INDEX "invoices_retail_reference_unique" ON "invoices"("pharmacyOrganizationId", "referenceNumber") WHERE "type" = 'RETAIL_SALE';
CREATE UNIQUE INDEX "invoices_dealer_reference_unique" ON "invoices"("pharmacyOrganizationId", "dealerOrganizationId", "referenceNumber") WHERE "type" = 'DEALER_PURCHASE';
CREATE UNIQUE INDEX "invoices_orderId_key" ON "invoices"("orderId");
CREATE UNIQUE INDEX "invoices_pharmacyOrganizationId_idempotencyKey_key" ON "invoices"("pharmacyOrganizationId", "idempotencyKey");
CREATE INDEX "invoices_pharmacyOrganizationId_recordedAt_idx" ON "invoices"("pharmacyOrganizationId", "recordedAt" DESC);
CREATE INDEX "invoices_customerId_recordedAt_idx" ON "invoices"("customerId", "recordedAt" DESC);
CREATE UNIQUE INDEX "invoice_lines_stockMovementId_key" ON "invoice_lines"("stockMovementId");
CREATE INDEX "invoice_lines_invoiceId_idx" ON "invoice_lines"("invoiceId");

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_pharmacyOrganizationId_fkey" FOREIGN KEY ("pharmacyOrganizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_dealerOrganizationId_fkey" FOREIGN KEY ("dealerOrganizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_inventoryBatchId_fkey" FOREIGN KEY ("inventoryBatchId") REFERENCES "inventory_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_stockMovementId_fkey" FOREIGN KEY ("stockMovementId") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
