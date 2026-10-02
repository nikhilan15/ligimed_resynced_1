import { randomUUID } from 'node:crypto';

import { createSessionToken, PERMISSIONS } from '@ligimed/auth';
import { createDatabaseClient, SessionRepository, type OrganizationType } from '@ligimed/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApi } from '../src/app.js';
import { TenantResourceService } from '../src/modules/organizations/tenant-resources.js';
import { createBrowserAuthentication } from '../src/platform/browser-authentication.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error(
    'Live PostgreSQL DATABASE_URL is required for tenant isolation integration tests',
  );
}

const database = createDatabaseClient({ databaseUrl });
const sessions = new SessionRepository(database);
const resources = new TenantResourceService(database, sessions);
const fullRoleId = randomUUID();
const readerRoleId = randomUUID();
const otherMemberId = randomUUID();
const otherUserId = randomUUID();
const noPermissionMemberId = randomUUID();
const noPermissionUserId = randomUUID();
let otherSession: { id: string; token: string };
let noPermissionSession: { id: string; token: string };

function fixture(type: OrganizationType) {
  return {
    organizationId: randomUUID(),
    type,
    userId: randomUUID(),
    membershipId: randomUUID(),
    addressId: randomUUID(),
    auditLogId: randomUUID(),
    session: { id: '', token: '' },
  };
}

const tenantA = fixture('PHARMACY');
const tenantB = fixture('DEALER');
const internalTenant = fixture('LIGIMED_INTERNAL');
const tenants = [tenantA, tenantB, internalTenant];

const resourceCases = [
  { name: 'users', method: 'getUser', id: (tenant: typeof tenantA) => tenant.userId },
  {
    name: 'memberships',
    method: 'getMembership',
    id: (tenant: typeof tenantA) => tenant.membershipId,
  },
  { name: 'addresses', method: 'getAddress', id: (tenant: typeof tenantA) => tenant.addressId },
  { name: 'sessions', method: 'getSession', id: (tenant: typeof tenantA) => tenant.session.id },
  { name: 'audit logs', method: 'getAuditLog', id: (tenant: typeof tenantA) => tenant.auditLogId },
] as const;

beforeAll(async () => {
  await database.$queryRaw`SELECT 1`;
  const permissions = await database.permission.findMany({
    where: { key: { in: [PERMISSIONS.ORGANIZATION_READ, PERMISSIONS.AUDIT_READ] } },
  });
  if (permissions.length !== 2) {
    throw new Error('Run the RBAC database seed before live tenant isolation integration tests');
  }
  const readPermission = permissions.find(
    (permission) => permission.key === PERMISSIONS.ORGANIZATION_READ,
  );
  if (!readPermission) throw new Error('organization.read permission is required');

  await database.role.create({
    data: {
      id: fullRoleId,
      key: `tenant-test-full-${fullRoleId}`,
      name: 'Tenant integration fixture',
      isSystem: false,
      permissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) },
    },
  });
  await database.role.create({
    data: {
      id: readerRoleId,
      key: `tenant-test-reader-${readerRoleId}`,
      name: 'Tenant read-only integration fixture',
      isSystem: false,
      permissions: { create: { permissionId: readPermission.id } },
    },
  });

  for (const tenant of tenants) {
    await database.organization.create({
      data: {
        id: tenant.organizationId,
        type: tenant.type,
        status: 'ACTIVE',
        legalName: 'Tenant isolation integration fixture',
        slug: `tenant-test-${tenant.organizationId}`,
        addresses: {
          create: {
            id: tenant.addressId,
            name: 'Test address',
            line1: 'Fixture road',
            city: 'Fixture city',
            district: 'Fixture district',
            state: 'Fixture state',
            stateCode: 'XX',
            postalCode: '000000',
          },
        },
      },
    });
    await database.user.create({
      data: {
        id: tenant.userId,
        displayName: 'Integration member',
        identities: {
          create: {
            type: 'EMAIL',
            normalizedValue: `${tenant.userId}@example.test`,
            passwordHash: 'fixture-sensitive-value',
          },
        },
        memberships: {
          create: {
            id: tenant.membershipId,
            organizationId: tenant.organizationId,
            status: 'ACTIVE',
            roles: { create: { roleId: fullRoleId } },
          },
        },
      },
    });
    tenant.session = await sessions.create({
      userId: tenant.userId,
      membershipId: tenant.membershipId,
      organizationId: tenant.organizationId,
    });
    await database.auditLog.create({
      data: {
        id: tenant.auditLogId,
        requestId: randomUUID(),
        actorUserId: tenant.userId,
        organizationId: tenant.organizationId,
        action: 'test.fixture',
        resourceType: 'organization',
        resourceId: tenant.organizationId,
        outcome: 'SUCCESS',
        details: { fixturePrivateDetail: 'must not be returned' },
      },
    });
  }

  for (const member of [
    { userId: otherUserId, membershipId: otherMemberId, roleId: readerRoleId },
    { userId: noPermissionUserId, membershipId: noPermissionMemberId, roleId: undefined },
  ]) {
    await database.user.create({
      data: {
        id: member.userId,
        memberships: {
          create: {
            id: member.membershipId,
            organizationId: tenantA.organizationId,
            status: 'ACTIVE',
            ...(member.roleId ? { roles: { create: { roleId: member.roleId } } } : {}),
          },
        },
      },
    });
  }
  otherSession = await sessions.create({
    userId: otherUserId,
    membershipId: otherMemberId,
    organizationId: tenantA.organizationId,
  });
  noPermissionSession = await sessions.create({
    userId: noPermissionUserId,
    membershipId: noPermissionMemberId,
    organizationId: tenantA.organizationId,
  });
}, 30_000);

afterAll(async () => {
  try {
    // Only remove UUID fixtures owned by this run; never reset or truncate the target database.
    await database.auditLog.deleteMany({
      where: { id: { in: tenants.map((tenant) => tenant.auditLogId) } },
    });
    await database.organization.deleteMany({
      where: { id: { in: tenants.map((tenant) => tenant.organizationId) } },
    });
    await database.user.deleteMany({
      where: {
        id: { in: [...tenants.map((tenant) => tenant.userId), otherUserId, noPermissionUserId] },
      },
    });
    await database.role.deleteMany({ where: { id: { in: [fullRoleId, readerRoleId] } } });
  } finally {
    await database.$disconnect();
  }
}, 30_000);

describe('Live PostgreSQL tenant isolation', () => {
  it.each(resourceCases)(
    'allows authorized access to $name within each tenant',
    async ({ method, id }) => {
      for (const tenant of tenants) {
        await expect(
          resources[method]({
            token: tenant.session.token,
            requestId: randomUUID(),
            resourceId: id(tenant),
          }),
        ).resolves.toMatchObject({ id: id(tenant) });
      }
    },
  );

  it.each(resourceCases)('denies cross-tenant $name in both directions', async ({ method, id }) => {
    for (const [actor, target] of [
      [tenantA, tenantB],
      [tenantB, tenantA],
    ] as const) {
      await expect(
        resources[method]({
          token: actor.session.token,
          requestId: randomUUID(),
          resourceId: id(target),
        }),
      ).rejects.toMatchObject({ status: 404, code: 'RESOURCE_NOT_FOUND' });
    }
  });

  it.each(resourceCases)(
    'rejects a forged organization claim for $name',
    async ({ method, id }) => {
      await expect(
        resources[method]({
          token: tenantA.session.token,
          requestId: randomUUID(),
          organizationId: tenantB.organizationId,
          resourceId: id(tenantB),
        }),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    },
  );

  it.each(resourceCases)(
    'does not grant internal administrators a $name tenant bypass',
    async ({ method, id }) => {
      await expect(
        resources[method]({
          token: internalTenant.session.token,
          requestId: randomUUID(),
          resourceId: id(tenantA),
        }),
      ).rejects.toMatchObject({ status: 404, code: 'RESOURCE_NOT_FOUND' });
    },
  );

  it.each(resourceCases)(
    'rejects access to $name without a real session',
    async ({ method, id }) => {
      for (const token of [undefined, 'unrecognized-session-token', createSessionToken()]) {
        await expect(
          resources[method]({ token, requestId: randomUUID(), resourceId: id(tenantA) }),
        ).rejects.toMatchObject({ status: 401, code: 'AUTHENTICATION_REQUIRED' });
      }
    },
  );

  it.each(resourceCases)(
    'rejects access to $name without its permission',
    async ({ method, id }) => {
      await expect(
        resources[method]({
          token: noPermissionSession.token,
          requestId: randomUUID(),
          resourceId: id(tenantA),
        }),
      ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    },
  );

  it.each(resourceCases)(
    'conceals whether another tenant owns a missing $name resource',
    async ({ method }) => {
      await expect(
        resources[method]({
          token: tenantA.session.token,
          requestId: randomUUID(),
          resourceId: randomUUID(),
        }),
      ).rejects.toMatchObject({
        status: 404,
        code: 'RESOURCE_NOT_FOUND',
        message: 'Resource not found',
      });
    },
  );

  it('denies another user session even inside the same organization', async () => {
    await expect(
      resources.getSession({
        token: tenantA.session.token,
        requestId: randomUUID(),
        resourceId: otherSession.id,
      }),
    ).rejects.toMatchObject({ status: 404, code: 'RESOURCE_NOT_FOUND' });
  });

  it('requires audit.read separately from organization.read', async () => {
    await expect(
      resources.getAddress({
        token: otherSession.token,
        requestId: randomUUID(),
        resourceId: tenantA.addressId,
      }),
    ).resolves.toMatchObject({ id: tenantA.addressId });
    await expect(
      resources.getAuditLog({
        token: otherSession.token,
        requestId: randomUUID(),
        resourceId: tenantA.auditLogId,
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
  });

  it('never exposes global identities, token hashes, or arbitrary audit details', async () => {
    const request = { token: tenantA.session.token, requestId: randomUUID() };
    const user = await resources.getUser({ ...request, resourceId: tenantA.userId });
    expect(Object.keys(user).sort()).toEqual(['displayName', 'id', 'isActive']);
    const session = await resources.getSession({ ...request, resourceId: tenantA.session.id });
    expect(session).not.toHaveProperty('tokenHash');
    expect(session).not.toHaveProperty('ipHash');
    const audit = await resources.getAuditLog({ ...request, resourceId: tenantA.auditLogId });
    expect(audit).not.toHaveProperty('details');
    expect(audit).not.toHaveProperty('ipHash');
  });

  it('rejects a caller-constructed privileged context in place of a credential', async () => {
    const forgedContext = {
      organizationId: tenantB.organizationId,
      userId: tenantB.userId,
      permissions: new Set(Object.values(PERMISSIONS)),
    };
    await expect(
      resources.getAddress({
        token: forgedContext as unknown as string,
        requestId: randomUUID(),
        resourceId: tenantB.addressId,
      }),
    ).rejects.toMatchObject({ status: 401, code: 'AUTHENTICATION_REQUIRED' });
  });

  it('validates resource identifiers before issuing resource queries', async () => {
    await expect(
      resources.getAddress({
        token: tenantA.session.token,
        requestId: randomUUID(),
        resourceId: 'invalid-resource-id',
      }),
    ).rejects.toMatchObject({ name: 'ZodError' });
  });

  it('enforces tenant and permission boundaries over HTTP with persisted browser sessions', async () => {
    const browser = createBrowserAuthentication({
      sessions,
      cookieName: 'ligimed_session',
      csrfSecret: randomUUID(),
      allowedOrigins: ['https://app.example.test'],
    });
    const app = await buildApi({
      configuration: {
        environment: 'test',
        allowedOrigins: ['https://app.example.test'],
        logLevel: 'error',
        trustProxy: false,
      },
      logger: false,
      registerRoutes(instance) {
        // This route is a test harness only; Phase 0 exposes no business resource endpoints.
        instance.get<{ Params: { organizationId: string; id: string } }>(
          '/test/organizations/:organizationId/addresses/:id',
          async (request) => {
            await browser.authenticate(request);
            return resources.getAddress({
              token: request.cookies['ligimed_session'],
              requestId: request.id,
              organizationId: request.params.organizationId,
              resourceId: request.params.id,
            });
          },
        );
      },
    });

    try {
      for (const tenant of [tenantA, tenantB]) {
        const response = await app.inject({
          url: `/test/organizations/${tenant.organizationId}/addresses/${tenant.addressId}`,
          headers: { cookie: `ligimed_session=${tenant.session.token}` },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          id: tenant.addressId,
          organizationId: tenant.organizationId,
        });
      }

      const negativeCases = [
        {
          token: tenantA.session.token,
          organizationId: tenantA.organizationId,
          resourceId: tenantB.addressId,
          status: 404,
          code: 'RESOURCE_NOT_FOUND',
        },
        {
          token: tenantB.session.token,
          organizationId: tenantB.organizationId,
          resourceId: tenantA.addressId,
          status: 404,
          code: 'RESOURCE_NOT_FOUND',
        },
        {
          token: tenantA.session.token,
          organizationId: tenantB.organizationId,
          resourceId: tenantB.addressId,
          status: 403,
          code: 'AUTHORIZATION_DENIED',
        },
        {
          token: noPermissionSession.token,
          organizationId: tenantA.organizationId,
          resourceId: tenantA.addressId,
          status: 403,
          code: 'AUTHORIZATION_DENIED',
        },
        {
          token: undefined,
          organizationId: tenantA.organizationId,
          resourceId: tenantA.addressId,
          status: 401,
          code: 'AUTHENTICATION_REQUIRED',
        },
        {
          token: createSessionToken(),
          organizationId: tenantA.organizationId,
          resourceId: tenantA.addressId,
          status: 401,
          code: 'AUTHENTICATION_REQUIRED',
        },
        {
          token: tenantA.session.token,
          organizationId: tenantA.organizationId,
          resourceId: 'malformed-id',
          status: 422,
          code: 'VALIDATION_FAILED',
        },
      ];
      for (const candidate of negativeCases) {
        const response = await app.inject({
          url: `/test/organizations/${candidate.organizationId}/addresses/${candidate.resourceId}`,
          headers: candidate.token ? { cookie: `ligimed_session=${candidate.token}` } : {},
        });
        expect(response.statusCode).toBe(candidate.status);
        expect(response.json()).toMatchObject({ status: candidate.status, code: candidate.code });
        expect(response.headers['content-type']).toContain('application/problem+json');
        expect(response.body).not.toContain(tenantA.session.token);
        expect(response.body).not.toContain(tenantB.session.token);
      }
    } finally {
      await app.close();
    }
  });
});
