ALTER TYPE "PharmacyAuthIntent" RENAME TO "PartnerAuthIntent";
ALTER TABLE "pharmacy_auth_attempts" RENAME TO "partner_auth_attempts";
ALTER TABLE "partner_auth_attempts" RENAME COLUMN "pharmacyName" TO "organizationName";
ALTER TABLE "partner_auth_attempts" ADD COLUMN "organizationType" "OrganizationType" NOT NULL DEFAULT 'PHARMACY';

CREATE TABLE "dealer_profiles" (
  "organizationId" UUID NOT NULL,
  "primaryAddressId" UUID,
  "operationalEmail" VARCHAR(320),
  "websiteUrl" VARCHAR(2048),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "dealer_profiles_pkey" PRIMARY KEY ("organizationId"),
  CONSTRAINT "dealer_profiles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "dealer_profiles_primaryAddressId_fkey" FOREIGN KEY ("primaryAddressId") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "dealer_profiles_primaryAddressId_key" ON "dealer_profiles"("primaryAddressId");
