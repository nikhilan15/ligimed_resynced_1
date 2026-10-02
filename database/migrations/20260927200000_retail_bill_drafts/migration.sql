CREATE TABLE "retail_bill_drafts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "customerId" UUID,
  "lines" JSONB NOT NULL,
  "createdById" UUID NOT NULL,
  "updatedById" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "retail_bill_drafts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "retail_bill_drafts_lines_array" CHECK (jsonb_typeof("lines") = 'array')
);
CREATE INDEX "retail_bill_drafts_organizationId_updatedAt_idx" ON "retail_bill_drafts"("organizationId", "updatedAt" DESC);
ALTER TABLE "retail_bill_drafts" ADD CONSTRAINT "retail_bill_drafts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "retail_bill_drafts" ADD CONSTRAINT "retail_bill_drafts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "retail_bill_drafts" ADD CONSTRAINT "retail_bill_drafts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "retail_bill_drafts" ADD CONSTRAINT "retail_bill_drafts_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoices" ADD COLUMN "discountMinor" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "invoice_lines" ADD COLUMN "discountMinor" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "invoices" DROP CONSTRAINT "invoice_amounts_nonnegative";
ALTER TABLE "invoices" ADD CONSTRAINT "invoice_amounts_nonnegative" CHECK (
  "subtotalMinor" >= 0 AND "discountMinor" >= 0 AND "discountMinor" <= "subtotalMinor"
  AND "taxMinor" >= 0 AND "deliveryChargeMinor" >= 0
  AND "totalMinor" = "subtotalMinor" - "discountMinor" + "taxMinor" + "deliveryChargeMinor"
);
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_line_values_valid";
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_line_values_valid" CHECK (
  "quantity" > 0 AND "unitPriceMinor" >= 0 AND "discountMinor" >= 0 AND "taxMinor" >= 0
  AND "subtotalMinor" = "unitPriceMinor" * "quantity"
  AND "discountMinor" <= "subtotalMinor"
  AND "lineTotalMinor" = "subtotalMinor" - "discountMinor" + "taxMinor"
);
