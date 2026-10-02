import { createHash, randomBytes } from 'node:crypto';

import type { RequestContext } from '@ligimed/types';

export { createOtpCode, hashOtpCode, matchesOtpCode, validateOtpHashSecret } from './otp.js';

export const PERMISSIONS = {
  ORGANIZATION_READ: 'organization.read',
  ORGANIZATION_UPDATE: 'organization.update',
  MEMBERSHIP_MANAGE: 'membership.manage',
  AUDIT_READ: 'audit.read',
  KYC_SUBMIT: 'kyc.submit',
  KYC_REVIEW: 'kyc.review',
  CATALOGUE_MANAGE: 'catalogue.manage',
  ORDER_CREATE: 'order.create',
  ORDER_READ: 'order.read',
  ORDER_MANAGE: 'order.manage',
  INVENTORY_READ: 'inventory.read',
  INVENTORY_MANAGE: 'inventory.manage',
  CUSTOMER_READ: 'customer.read',
  CUSTOMER_MANAGE: 'customer.manage',
  BILLING_READ: 'billing.read',
  BILLING_MANAGE: 'billing.manage',
  DOCUMENT_READ: 'document.read',
  DOCUMENT_MANAGE: 'document.manage',
  DOCUMENT_FINANCE: 'document.finance',
  DOCUMENT_REVIEW: 'document.review',
  DOCUMENT_POLICY: 'document.policy',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export interface OrganizationResource {
  organizationId: string;
}

export class AuthorizationError extends Error {
  readonly code = 'AUTHORIZATION_DENIED';

  constructor(message = 'The requested action is not permitted') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export function requirePermission(context: RequestContext, permission: Permission): void {
  if (!context.permissions.has(permission)) throw new AuthorizationError();
}

export function requireOrganizationScope(
  context: RequestContext,
  resource: OrganizationResource,
): void {
  if (context.organizationId !== resource.organizationId) throw new AuthorizationError();
}

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
