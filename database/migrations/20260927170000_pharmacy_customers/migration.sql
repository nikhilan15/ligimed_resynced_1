CREATE TABLE "customers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "displayName" VARCHAR(200) NOT NULL,
  "phoneNumber" VARCHAR(20),
  "email" VARCHAR(320),
  "archivedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "customers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customers_name_not_blank" CHECK (length(btrim("displayName")) >= 2)
);

CREATE INDEX "customers_organizationId_archivedAt_createdAt_idx" ON "customers"("organizationId", "archivedAt", "createdAt" DESC);
CREATE INDEX "customers_organizationId_displayName_idx" ON "customers"("organizationId", "displayName");
