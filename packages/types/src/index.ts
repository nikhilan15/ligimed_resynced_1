export const ORGANIZATION_TYPES = ['PHARMACY', 'DEALER', 'TRANSPORT', 'LIGIMED_INTERNAL'] as const;

export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const ORGANIZATION_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED'] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export const MEMBERSHIP_STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const KYC_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'VERIFIED',
  'REJECTED',
  'EXPIRED',
] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

export interface Money {
  /** Integer minor units serialized as a base-10 string, e.g. paise for INR. */
  amountMinor: string;
  currency: string;
}

export interface RequestContext {
  requestId: string;
  userId: string;
  organizationId: string;
  membershipId: string;
  permissions: ReadonlySet<string>;
}
