import { describe, expect, it } from 'vitest';

import { parseServerEnvironment } from '../src/index.js';

const validEnvironment = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://ligimed:secret@localhost:5432/ligimed',
  REDIS_URL: 'redis://localhost:6379',
  ALLOWED_ORIGINS: 'http://localhost:3000,http://localhost:3001',
  OTP_PROVIDER: 'development',
  STORAGE_PROVIDER: 'local',
  PAYMENT_PROVIDER: 'sandbox',
  CSRF_SECRET: 'test-csrf-secret-at-least-32-bytes-long',
  OTP_HASH_SECRET: 'test-otp-secret-at-least-32-bytes-long',
};

describe('parseServerEnvironment', () => {
  it('parses and normalizes a valid environment', () => {
    const environment = parseServerEnvironment(validEnvironment);

    expect(environment.API_PORT).toBe(4000);
    expect(environment.ALLOWED_ORIGINS).toEqual(['http://localhost:3000', 'http://localhost:3001']);
  });

  it('blocks development providers in production', () => {
    expect(() => parseServerEnvironment({ ...validEnvironment, NODE_ENV: 'production' })).toThrow(
      /Production cannot use development providers/,
    );
  });

  it('allows an omitted Redis URL when no Redis adapter is configured', () => {
    expect(
      parseServerEnvironment({ ...validEnvironment, REDIS_URL: undefined }).REDIS_URL,
    ).toBeUndefined();
  });

  it('requires authentication secrets without fallback values', () => {
    expect(() => parseServerEnvironment({ ...validEnvironment, CSRF_SECRET: undefined })).toThrow();
    expect(() =>
      parseServerEnvironment({ ...validEnvironment, OTP_HASH_SECRET: 'short' }),
    ).toThrow();
  });

  it('rejects origin paths and credentials', () => {
    expect(() =>
      parseServerEnvironment({ ...validEnvironment, ALLOWED_ORIGINS: 'https://example.com/path' }),
    ).toThrow();
    expect(() =>
      parseServerEnvironment({
        ...validEnvironment,
        ALLOWED_ORIGINS: 'https://user:pass@example.com',
      }),
    ).toThrow();
  });

  it('enforces HTTPS, distinct secrets and a safe proxy boundary in production', () => {
    const production = {
      ...validEnvironment,
      NODE_ENV: 'production',
      OTP_PROVIDER: 'sms',
      STORAGE_PROVIDER: 's3',
      PAYMENT_PROVIDER: 'configured',
      ALLOWED_ORIGINS: 'https://app.example.com',
    };
    expect(parseServerEnvironment(production).NODE_ENV).toBe('production');
    expect(() =>
      parseServerEnvironment({ ...production, ALLOWED_ORIGINS: 'http://app.example.com' }),
    ).toThrow();
    expect(() => parseServerEnvironment({ ...production, TRUST_PROXY: 'true' })).toThrow();
    expect(() =>
      parseServerEnvironment({ ...production, OTP_HASH_SECRET: production.CSRF_SECRET }),
    ).toThrow();
  });
});
