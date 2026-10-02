CREATE TABLE "admin_auth_attempts" (
    "challengeId" UUID NOT NULL,
    "browserTokenHash" CHAR(64) NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    CONSTRAINT "admin_auth_attempts_pkey" PRIMARY KEY ("challengeId")
);

ALTER TABLE "admin_auth_attempts"
ADD CONSTRAINT "admin_auth_attempts_challengeId_fkey"
FOREIGN KEY ("challengeId") REFERENCES "otp_challenges"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
