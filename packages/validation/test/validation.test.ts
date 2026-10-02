import { describe, expect, it } from 'vitest';

import {
  adminKycDecisionSchema,
  adminKycQueueQuerySchema,
  indianPhoneNumberSchema,
  moneySchema,
} from '../src/index.js';

describe('shared validation', () => {
  it('accepts normalized Indian mobile numbers', () => {
    expect(indianPhoneNumberSchema.parse('+919876543210')).toBe('+919876543210');
  });

  it('rejects floating-point money', () => {
    expect(() => moneySchema.parse({ amountMinor: '10.50', currency: 'INR' })).toThrow();
  });

  it('requires an actionable reason for KYC rejection', () => {
    expect(() => adminKycDecisionSchema.parse({ decision: 'REJECT', reason: 'no' })).toThrow();
    expect(adminKycDecisionSchema.parse({ decision: 'APPROVE' })).toEqual({ decision: 'APPROVE' });
  });

  it('bounds admin queue pagination', () => {
    expect(adminKycQueueQuerySchema.parse({ limit: '20' })).toEqual({ limit: 20 });
    expect(() => adminKycQueueQuerySchema.parse({ limit: '51' })).toThrow();
  });
});
