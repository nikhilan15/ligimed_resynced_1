import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export function validateOtpHashSecret(secret: string): void {
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('OTP_HASH_SECRET must contain at least 32 bytes');
  }
}

/** Generate uniformly distributed six-digit codes without modulo bias. */
export function createOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** Bind each code to one challenge; a database leak does not permit offline enumeration. */
export function hashOtpCode(secret: string, challengeId: string, code: string): string {
  validateOtpHashSecret(secret);
  return createHmac('sha256', secret)
    .update(JSON.stringify(['ligimed.otp.v1', challengeId, code]), 'utf8')
    .digest('hex');
}

export function matchesOtpCode(
  secret: string,
  challengeId: string,
  code: string,
  storedHash: string,
): boolean {
  if (!/^\d{6}$/.test(code) || !/^[a-f0-9]{64}$/.test(storedHash)) return false;
  return timingSafeEqual(
    Buffer.from(hashOtpCode(secret, challengeId, code), 'hex'),
    Buffer.from(storedHash, 'hex'),
  );
}
