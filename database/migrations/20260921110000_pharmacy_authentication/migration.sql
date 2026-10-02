CREATE TYPE "SessionScope" AS ENUM ('FULL', 'ONBOARDING');
CREATE TYPE "PharmacyAuthIntent" AS ENUM ('LOGIN', 'REGISTER');
ALTER TABLE "sessions" ADD COLUMN "scope" "SessionScope" NOT NULL DEFAULT 'FULL';

CREATE TABLE "pharmacy_auth_attempts" (
  "challengeId" UUID NOT NULL,
  "browserTokenHash" CHAR(64) NOT NULL,
  "intent" "PharmacyAuthIntent" NOT NULL,
  "displayName" VARCHAR(200),
  "pharmacyName" VARCHAR(250),
  "verifiedAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3),
  CONSTRAINT "pharmacy_auth_attempts_pkey" PRIMARY KEY ("challengeId"),
  CONSTRAINT "pharmacy_auth_attempts_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "otp_challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "auth_rate_limits" (
  "key" CHAR(64) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "auth_rate_limits_expiresAt_idx" ON "auth_rate_limits"("expiresAt");
