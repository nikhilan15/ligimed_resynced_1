CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  category VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  "referenceNumber" VARCHAR(100), "holderName" VARCHAR(200), "licenceType" VARCHAR(100),
  "issuedAt" DATE, "expiresAt" DATE, "bankAccountLast4" CHAR(4), "bankIfsc" VARCHAR(11),
  "orderId" UUID REFERENCES orders(id) ON DELETE RESTRICT,
  "invoiceId" UUID REFERENCES invoices(id) ON DELETE RESTRICT,
  "replacesDocumentId" UUID UNIQUE REFERENCES documents(id) ON DELETE RESTRICT,
  "idempotencyKey" UUID NOT NULL, "objectKey" VARCHAR(500) NOT NULL UNIQUE,
  "originalFilename" VARCHAR(255) NOT NULL, "contentType" VARCHAR(100) NOT NULL,
  "contentLength" INTEGER NOT NULL CHECK ("contentLength" > 0 AND "contentLength" <= 5242880),
  "checksumSha256" CHAR(64) NOT NULL,
  "reviewStatus" VARCHAR(30) NOT NULL DEFAULT 'PENDING_REVIEW' CHECK ("reviewStatus" IN ('PENDING_REVIEW', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED')),
  "rejectionReason" VARCHAR(1000), "uploadedById" UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT documents_dates_valid CHECK ("expiresAt" IS NULL OR "issuedAt" IS NULL OR "expiresAt" >= "issuedAt"),
  CONSTRAINT documents_rejection_reason CHECK ("reviewStatus" <> 'REJECTED' OR "rejectionReason" IS NOT NULL),
  CONSTRAINT documents_category_valid CHECK (category IN ('DRUG_LICENCE','GST_REGISTRATION','PAN','BUSINESS_REGISTRATION','REPRESENTATIVE_KYC','BANK_DOCUMENT','SETTLEMENT_STATEMENT','DEALER_INVOICE','PURCHASE_INVOICE','SALES_INVOICE','GST_INVOICE','CREDIT_NOTE','DEBIT_NOTE','PURCHASE_ORDER','ORDER_CONFIRMATION','RETURN_REQUEST','RETURN_APPROVAL','RETURN_RECEIPT','PICKUP_CONFIRMATION','RETURN_CORRESPONDENCE','CREDIT_APPLICATION','CREDIT_AGREEMENT','REPAYMENT_SCHEDULE','PAYMENT_RECEIPT','FINANCING_STATEMENT','OTHER'))
);
CREATE UNIQUE INDEX "documents_organizationId_idempotencyKey_key" ON documents("organizationId", "idempotencyKey");
CREATE INDEX "documents_organizationId_category_createdAt_idx" ON documents("organizationId", category, "createdAt" DESC);
CREATE INDEX "documents_reviewStatus_createdAt_idx" ON documents("reviewStatus", "createdAt");
CREATE INDEX "documents_expiresAt_idx" ON documents("expiresAt");
CREATE TABLE document_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "documentId" UUID NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  "reviewerId" UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status VARCHAR(30) NOT NULL CHECK (status IN ('UNDER_REVIEW','VERIFIED','REJECTED')),
  reason VARCHAR(1000), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "document_reviews_documentId_createdAt_idx" ON document_reviews("documentId", "createdAt");
CREATE TABLE document_reminder_policies (
  id VARCHAR(30) PRIMARY KEY DEFAULT 'pharmacy',
  thresholds INTEGER[] NOT NULL DEFAULT ARRAY[90,60,30],
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO document_reminder_policies (id) VALUES ('pharmacy');
CREATE TABLE document_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "documentId" UUID NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  "thresholdDays" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "document_reminders_documentId_thresholdDays_key" ON document_reminders("documentId", "thresholdDays");
