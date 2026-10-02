import { describe, expect, it } from 'vitest';
import {
  pharmacyOtpRequestSchema,
  pharmacyOtpVerifySchema,
  pharmacySelectionSchema,
} from '../src/index.js';

describe('pharmacy authentication input', () => {
  it('normalizes names but requires a canonical Indian phone number', () => {
    const input = {
      intent: 'REGISTER',
      phoneNumber: '+919876543210',
      displayName: '  Test Owner  ',
      pharmacyName: '  Test Pharmacy ',
    };
    expect(pharmacyOtpRequestSchema.parse(input)).toMatchObject({
      displayName: 'Test Owner',
      pharmacyName: 'Test Pharmacy',
    });
    for (const phoneNumber of ['9876543210', '+915123456789', '+919876543210 ', 'not a number']) {
      expect(pharmacyOtpRequestSchema.safeParse({ ...input, phoneNumber }).success).toBe(false);
    }
  });
  it('rejects privilege, organization and tenant fields from the browser', () => {
    for (const field of ['role', 'organizationId', 'status', 'permissions']) {
      expect(
        pharmacyOtpRequestSchema.safeParse({
          intent: 'LOGIN',
          phoneNumber: '+919876543210',
          [field]: 'ADMIN',
        }).success,
      ).toBe(false);
    }
  });
  it('requires registration names and validates codes and selection IDs', () => {
    expect(
      pharmacyOtpRequestSchema.safeParse({ intent: 'REGISTER', phoneNumber: '+919876543210' })
        .success,
    ).toBe(false);
    expect(
      pharmacyOtpVerifySchema.safeParse({ challengeId: 'invalid', code: '123456' }).success,
    ).toBe(false);
    expect(
      pharmacySelectionSchema.safeParse({ challengeId: 'invalid', membershipId: 'invalid' })
        .success,
    ).toBe(false);
  });
});
