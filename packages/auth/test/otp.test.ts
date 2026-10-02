import { describe, expect, it } from 'vitest';

import { createOtpCode, hashOtpCode, matchesOtpCode, validateOtpHashSecret } from '../src/index.js';

const secret = 'test-only-secret-at-least-thirty-two-bytes';

describe('OTP secret handling', () => {
  it('requires an explicit sufficiently long hashing secret', () => {
    expect(() => validateOtpHashSecret('short')).toThrow('OTP_HASH_SECRET');
    expect(() => validateOtpHashSecret(secret)).not.toThrow();
  });

  it('generates six numeric digits', () => {
    for (let attempt = 0; attempt < 32; attempt += 1) expect(createOtpCode()).toMatch(/^\d{6}$/);
  });

  it('binds hashes to both the server secret and challenge identity', () => {
    const hash = hashOtpCode(secret, 'challenge-a', '012345');
    expect(hash).toHaveLength(64);
    expect(matchesOtpCode(secret, 'challenge-a', '012345', hash)).toBe(true);
    expect(matchesOtpCode(secret, 'challenge-a', '012346', hash)).toBe(false);
    expect(matchesOtpCode(secret, 'challenge-b', '012345', hash)).toBe(false);
    expect(matchesOtpCode(`${secret}-different`, 'challenge-a', '012345', hash)).toBe(false);
    expect(matchesOtpCode(secret, 'challenge-a', '012345', 'invalid-hash')).toBe(false);
  });
});
