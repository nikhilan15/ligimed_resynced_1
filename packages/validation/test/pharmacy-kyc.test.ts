import { describe, expect, it } from 'vitest';

import {
  kycEvidenceMetadataSchema,
  kycSubmitSchema,
  pharmacyKycProfileInputSchema,
} from '../src/index.js';

const validProfile = {
  legalName: 'LigiMed Test Pharmacy Private Limited',
  tradeName: 'LigiMed Test Pharmacy',
  operationalEmail: 'OWNER@EXAMPLE.COM',
  websiteUrl: 'https://example.com/pharmacy',
  authorizedRepresentativeName: 'Test Owner',
  authorizedRepresentativeRole: 'Owner',
  address: {
    name: 'Registered pharmacy',
    line1: '12 Health Street',
    line2: '',
    city: 'Bengaluru',
    district: 'Bengaluru Urban',
    state: 'Karnataka',
    stateCode: 'KA',
    postalCode: '560001',
    country: 'IN',
  },
};

describe('pharmacy KYC validation', () => {
  it('normalizes optional profile fields and email', () => {
    expect(pharmacyKycProfileInputSchema.parse(validProfile)).toMatchObject({
      operationalEmail: 'owner@example.com',
      address: { line2: null },
    });
    expect(
      pharmacyKycProfileInputSchema.parse({
        ...validProfile,
        tradeName: '',
        operationalEmail: '',
        websiteUrl: '',
      }),
    ).toMatchObject({ tradeName: null, operationalEmail: null, websiteUrl: null });
  });

  it('rejects invalid PIN codes, non-HTTP websites and privileged extra fields', () => {
    expect(() =>
      pharmacyKycProfileInputSchema.parse({
        ...validProfile,
        address: { ...validProfile.address, postalCode: '5600' },
      }),
    ).toThrow();
    expect(() =>
      pharmacyKycProfileInputSchema.parse({ ...validProfile, websiteUrl: 'javascript:alert(1)' }),
    ).toThrow();
    expect(() =>
      pharmacyKycProfileInputSchema.parse({ ...validProfile, status: 'VERIFIED' }),
    ).toThrow();
  });

  it('validates evidence metadata and an explicit declaration', () => {
    expect(
      kycEvidenceMetadataSchema.parse({
        category: 'DRUG_LICENCE',
        referenceNumber: '',
        expiresAt: '',
      }),
    ).toEqual({ category: 'DRUG_LICENCE', referenceNumber: null, expiresAt: null });
    expect(() => kycEvidenceMetadataSchema.parse({ category: 'PASSPORT' })).toThrow();
    expect(() => kycSubmitSchema.parse({ declarationAccepted: false })).toThrow();
  });
});
