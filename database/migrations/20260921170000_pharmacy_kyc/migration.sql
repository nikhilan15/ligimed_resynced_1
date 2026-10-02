CREATE TYPE "KycStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED');
CREATE TYPE "KycEvidenceCategory" AS ENUM ('DRUG_LICENCE', 'GST_REGISTRATION', 'PAN', 'BUSINESS_REGISTRATION', 'BANK_DOCUMENT', 'OTHER');
CREATE TYPE "KycEvidenceStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

CREATE TABLE "pharmacy_profiles" (
    "organizationId" UUID NOT NULL,
    "primaryAddressId" UUID,
    "operationalEmail" VARCHAR(320),
    "websiteUrl" VARCHAR(2048),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "pharmacy_profiles_pkey" PRIMARY KEY ("organizationId")
);

CREATE TABLE "kyc_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'DRAFT',
    "authorizedRepresentativeName" VARCHAR(200) NOT NULL,
    "authorizedRepresentativeRole" VARCHAR(100),
    "declarationAcceptedAt" TIMESTAMPTZ(3),
    "submittedAt" TIMESTAMPTZ(3),
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewedById" UUID,
    "rejectionReason" VARCHAR(1000),
    "createdById" UUID NOT NULL,
    "updatedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "kyc_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "kyc_evidence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "kycRecordId" UUID NOT NULL,
    "category" "KycEvidenceCategory" NOT NULL,
    "referenceNumber" VARCHAR(100),
    "expiresAt" DATE,
    "objectKey" VARCHAR(500) NOT NULL,
    "originalFilename" VARCHAR(255) NOT NULL,
    "contentType" VARCHAR(100) NOT NULL,
    "contentLength" INTEGER NOT NULL,
    "checksumSha256" CHAR(64) NOT NULL,
    "status" "KycEvidenceStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" VARCHAR(1000),
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "kyc_evidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pharmacy_profiles_primaryAddressId_key" ON "pharmacy_profiles"("primaryAddressId");
CREATE UNIQUE INDEX "kyc_records_organizationId_revision_key" ON "kyc_records"("organizationId", "revision");
CREATE INDEX "kyc_records_organizationId_status_createdAt_idx" ON "kyc_records"("organizationId", "status", "createdAt" DESC);
CREATE UNIQUE INDEX "kyc_evidence_objectKey_key" ON "kyc_evidence"("objectKey");
CREATE INDEX "kyc_evidence_organizationId_kycRecordId_idx" ON "kyc_evidence"("organizationId", "kycRecordId");
CREATE INDEX "kyc_evidence_organizationId_status_idx" ON "kyc_evidence"("organizationId", "status");

ALTER TABLE "pharmacy_profiles" ADD CONSTRAINT "pharmacy_profiles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pharmacy_profiles" ADD CONSTRAINT "pharmacy_profiles_primaryAddressId_fkey" FOREIGN KEY ("primaryAddressId") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "kyc_records" ADD CONSTRAINT "kyc_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kyc_records" ADD CONSTRAINT "kyc_records_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "kyc_records" ADD CONSTRAINT "kyc_records_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "kyc_records" ADD CONSTRAINT "kyc_records_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "kyc_evidence" ADD CONSTRAINT "kyc_evidence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kyc_evidence" ADD CONSTRAINT "kyc_evidence_kycRecordId_fkey" FOREIGN KEY ("kycRecordId") REFERENCES "kyc_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kyc_evidence" ADD CONSTRAINT "kyc_evidence_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
