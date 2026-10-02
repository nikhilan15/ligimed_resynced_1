import { describe, expect, it } from 'vitest';

import type { RequestContext } from '@ligimed/types';

import {
  AuthorizationError,
  PERMISSIONS,
  createSessionToken,
  hashSessionToken,
  requireOrganizationScope,
  requirePermission,
} from '../src/index.js';

const context: RequestContext = {
  requestId: 'request-1',
  userId: 'user-1',
  organizationId: 'organization-a',
  membershipId: 'membership-1',
  permissions: new Set([PERMISSIONS.ORGANIZATION_READ]),
};

describe('authorization primitives', () => {
  it('rejects permissions that are not granted', () => {
    expect(() => requirePermission(context, PERMISSIONS.KYC_REVIEW)).toThrow(AuthorizationError);
  });

  it('rejects resources owned by another organization', () => {
    expect(() => requireOrganizationScope(context, { organizationId: 'organization-b' })).toThrow(
      AuthorizationError,
    );
  });

  it('creates random tokens and stores deterministic hashes', () => {
    const first = createSessionToken();
    const second = createSessionToken();

    expect(first).not.toBe(second);
    expect(hashSessionToken(first)).toHaveLength(64);
    expect(hashSessionToken(first)).toBe(hashSessionToken(first));
  });
});
