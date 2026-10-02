import { randomUUID } from 'node:crypto';

import { createOtpCode, hashOtpCode, matchesOtpCode, validateOtpHashSecret } from '@ligimed/auth';
import { idSchema, otpIdentifierSchema } from '@ligimed/validation';

import type { OtpPurpose, PrismaClient } from '../generated/prisma/client.js';

const purposes: ReadonlySet<string> = new Set([
  'SIGN_IN',
  'VERIFY_PHONE',
  'RECOVER_ACCOUNT',
  'STEP_UP_AUTH',
]);

export class OtpRateLimitError extends Error {
  readonly code = 'OTP_RATE_LIMITED';
  constructor() {
    super('Too many authentication attempts; please try again later');
    this.name = 'OtpRateLimitError';
  }
}

export type OtpVerificationResult = 'VERIFIED' | 'INVALID' | 'EXPIRED' | 'LOCKED' | 'RATE_LIMITED';

/** Internal persistence contract. Plain codes are delivered to a provider, never serialized to an API. */
export class OtpRepository {
  constructor(
    private readonly database: PrismaClient,
    private readonly otpHashSecret: string,
  ) {
    validateOtpHashSecret(otpHashSecret);
  }

  async issue(input: { identifier: string; purpose: OtpPurpose }): Promise<{
    id: string;
    code: string;
    expiresAt: Date;
  }> {
    const identifier = this.validateSubject(input.identifier, input.purpose);
    return this.database.$transaction(async (transaction) => {
      const lockKey = JSON.stringify(['ligimed.otp', identifier, input.purpose]);
      await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      const now = new Date();
      const recent = await transaction.otpChallenge.findMany({
        where: {
          identifier,
          purpose: input.purpose,
          createdAt: { gte: new Date(now.getTime() - 15 * 60_000) },
        },
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      const latest = recent[0];
      if (recent.length >= 5 || (latest && now.getTime() - latest.createdAt.getTime() < 60_000)) {
        throw new OtpRateLimitError();
      }
      // Resending invalidates earlier outstanding challenges for this subject and purpose.
      await transaction.otpChallenge.updateMany({
        where: { identifier, purpose: input.purpose, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      const id = randomUUID();
      const code = createOtpCode();
      const expiresAt = new Date(now.getTime() + 5 * 60_000);
      await transaction.otpChallenge.create({
        data: {
          id,
          identifier,
          purpose: input.purpose,
          codeHash: hashOtpCode(this.otpHashSecret, id, code),
          maxAttempts: 5,
          expiresAt,
        },
      });
      return { id, code, expiresAt };
    });
  }

  async verify(input: {
    challengeId: string;
    identifier: string;
    purpose: OtpPurpose;
    code: string;
  }): Promise<OtpVerificationResult> {
    const identifier = this.validateSubject(input.identifier, input.purpose);
    if (!idSchema.safeParse(input.challengeId).success) return 'INVALID';
    return this.database.$transaction(async (transaction) => {
      const lockKey = JSON.stringify(['ligimed.otp', identifier, input.purpose]);
      await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      const challenge = await transaction.otpChallenge.findFirst({
        where: { id: input.challengeId, identifier, purpose: input.purpose },
      });
      if (!challenge || challenge.consumedAt || challenge.status === 'VERIFIED') return 'INVALID';
      if (challenge.status === 'LOCKED' || challenge.attempts >= challenge.maxAttempts)
        return 'LOCKED';
      const now = new Date();
      if (challenge.status === 'EXPIRED' || challenge.expiresAt.getTime() <= now.getTime()) {
        await transaction.otpChallenge.update({
          where: { id: challenge.id },
          data: { status: 'EXPIRED' },
        });
        return 'EXPIRED';
      }
      const recentAttempts = await transaction.otpChallenge.aggregate({
        where: {
          identifier,
          purpose: input.purpose,
          createdAt: { gte: new Date(now.getTime() - 15 * 60_000) },
        },
        _sum: { attempts: true },
      });
      if ((recentAttempts._sum.attempts ?? 0) >= 20) return 'RATE_LIMITED';
      const matches = matchesOtpCode(
        this.otpHashSecret,
        challenge.id,
        input.code,
        challenge.codeHash,
      );
      const attempts = challenge.attempts + 1;
      await transaction.otpChallenge.update({
        where: { id: challenge.id },
        data: {
          attempts,
          status: matches ? 'VERIFIED' : attempts >= challenge.maxAttempts ? 'LOCKED' : 'PENDING',
          ...(matches ? { consumedAt: now } : {}),
        },
      });
      return matches ? 'VERIFIED' : attempts >= challenge.maxAttempts ? 'LOCKED' : 'INVALID';
    });
  }

  private validateSubject(identifier: string, purpose: OtpPurpose): string {
    if (!purposes.has(purpose)) throw new Error('A valid OTP purpose is required');
    return otpIdentifierSchema.parse(identifier);
  }
}
