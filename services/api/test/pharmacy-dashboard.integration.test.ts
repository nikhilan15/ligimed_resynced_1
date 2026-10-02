import { randomUUID } from 'node:crypto';

import { createDatabaseClient, SessionRepository } from '@ligimed/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApi } from '../src/app.js';
import { registerPharmacyDashboard } from '../src/modules/organizations/pharmacy-dashboard-routes.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('A live PostgreSQL database is required.');
const database = createDatabaseClient({ databaseUrl });
const sessions = new SessionRepository(database);
const origin = 'http://localhost:3000';
const organizationIds: string[] = [];
const userIds: string[] = [];
const app = await buildApi({
  logger: false,
  configuration: {
    environment: 'test',
    allowedOrigins: [origin],
    logLevel: 'info',
    trustProxy: false,
  },
  registerRoutes: (api) =>
    registerPharmacyDashboard(api, {
      database,
      cookieName: 'ligimed_session',
      csrfSecret: 'integration-csrf-secret-at-least-32-bytes',
      allowedOrigins: [origin],
    }),
});

async function client(options: {
  type?: 'PHARMACY' | 'DEALER';
  status?: 'PENDING' | 'ACTIVE';
  scope?: 'ONBOARDING' | 'FULL';
  kycStatus?: 'DRAFT' | 'SUBMITTED' | 'VERIFIED';
}) {
  const type = options.type ?? 'PHARMACY';
  const status = options.status ?? 'PENDING';
  const scope = options.scope ?? 'ONBOARDING';
  const organizationId = randomUUID();
  const userId = randomUUID();
  organizationIds.push(organizationId);
  userIds.push(userId);
  const membership = await database.membership.create({
    data: {
      user: { create: { id: userId, displayName: 'Dashboard Owner' } },
      organization: {
        create: {
          id: organizationId,
          type,
          status,
          legalName: 'Dashboard Pharmacy Private Limited',
          tradeName: type === 'PHARMACY' ? 'Dashboard Pharmacy' : 'Dashboard Dealer',
          slug: `dashboard-${organizationId}`,
        },
      },
      status: 'ACTIVE',
      joinedAt: new Date(),
      roles: {
        create: {
          role: { connect: { key: type === 'PHARMACY' ? 'PHARMACY_ADMIN' : 'DEALER_ADMIN' } },
        },
      },
    },
  });
  if (options.kycStatus) {
    await database.kycRecord.create({
      data: {
        organizationId,
        revision: 1,
        status: options.kycStatus,
        authorizedRepresentativeName: 'Dashboard Owner',
        submittedAt: options.kycStatus === 'DRAFT' ? null : new Date(),
        createdById: userId,
        updatedById: userId,
      },
    });
  }
  const session = await sessions.create({
    userId,
    membershipId: membership.id,
    organizationId,
    scope,
  });
  return { organizationId, cookie: `ligimed_session=${session.token}` };
}

beforeAll(async () => {
  expect(await database.role.findUnique({ where: { key: 'PHARMACY_ADMIN' } })).not.toBeNull();
});

afterAll(async () => {
  try {
    await database.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await database.user.deleteMany({ where: { id: { in: userIds } } });
  } finally {
    await app.close();
    await database.$disconnect();
  }
});

describe('PH1.3 pharmacy dashboard', () => {
  it('requires authentication', async () => {
    expect((await app.inject({ url: '/api/v1/pharmacy/dashboard' })).statusCode).toBe(401);
  });

  it('returns a limited, truthful dashboard while submitted KYC awaits review', async () => {
    const item = await client({ kycStatus: 'SUBMITTED' });
    const response = await app.inject({
      url: '/api/v1/pharmacy/dashboard',
      headers: { cookie: item.cookie },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<Record<string, unknown>>()).toMatchObject({
      pharmacy: { id: item.organizationId, name: 'Dashboard Pharmacy', status: 'PENDING' },
      access: 'ONBOARDING',
      onboarding: { kycStatus: 'SUBMITTED', action: 'AWAIT_REVIEW' },
      metrics: {
        todaysOrders: { value: null, available: false, availableIn: 'PH1.9 Orders' },
      },
      recentPurchases: [],
      importantNotifications: [],
    });
  });

  it('derives tenancy from the session and ignores organization query tampering', async () => {
    const owner = await client({ kycStatus: 'DRAFT' });
    const outsider = await client({ kycStatus: 'SUBMITTED' });
    const response = await app.inject({
      url: `/api/v1/pharmacy/dashboard?organizationId=${outsider.organizationId}`,
      headers: { cookie: owner.cookie },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<{ pharmacy: { id: string } }>().pharmacy.id).toBe(owner.organizationId);
  });

  it('returns full account access without fabricating unreleased business metrics', async () => {
    const item = await client({ status: 'ACTIVE', scope: 'FULL', kycStatus: 'VERIFIED' });
    const response = await app.inject({
      url: '/api/v1/pharmacy/dashboard',
      headers: { cookie: item.cookie },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<Record<string, unknown>>()).toMatchObject({
      access: 'FULL',
      onboarding: { kycStatus: 'VERIFIED', action: 'NONE' },
      metrics: { inventoryValue: { value: null, available: false } },
    });
  });

  it('denies non-pharmacy organizations', async () => {
    const dealer = await client({ type: 'DEALER', status: 'ACTIVE', scope: 'FULL' });
    const response = await app.inject({
      url: '/api/v1/pharmacy/dashboard',
      headers: { cookie: dealer.cookie },
    });
    expect(response.statusCode).toBe(403);
  });
});
