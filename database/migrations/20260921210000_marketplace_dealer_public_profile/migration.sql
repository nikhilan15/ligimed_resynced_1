CREATE TABLE "dealer_public_profiles" (
    "organizationId" UUID NOT NULL,
    "summary" VARCHAR(1000),
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(100) NOT NULL,
    "serviceAreas" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "dealer_public_profiles_pkey" PRIMARY KEY ("organizationId")
);

CREATE INDEX "dealer_public_profiles_state_city_idx" ON "dealer_public_profiles"("state", "city");

ALTER TABLE "dealer_public_profiles"
ADD CONSTRAINT "dealer_public_profiles_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
