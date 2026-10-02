import { createHmac, randomUUID } from 'node:crypto';

import { createDatabaseClient, SessionRepository } from '@ligimed/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApi } from '../src/app.js';
import { registerDealerCatalogue } from '../src/modules/marketplace/dealer-catalogue-routes.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('A live PostgreSQL database is required.');
const database = createDatabaseClient({ databaseUrl });
const sessions = new SessionRepository(database);
const csrfSecret = 'dealer-catalogue-csrf-secret-at-least-32-bytes';
const origin = 'http://localhost:3001';
const organizationIds: string[] = [];
const userIds: string[] = [];
const listingIds: string[] = [];
const productIds: string[] = [];
const manufacturerIds: string[] = [];
const categoryIds: string[] = [];

const app = await buildApi({
  logger: false,
  configuration: {
    environment: 'test',
    allowedOrigins: [origin],
    logLevel: 'info',
    trustProxy: false,
  },
  registerRoutes: (api) =>
    registerDealerCatalogue(api, {
      database,
      cookieName: 'ligimed_session_dealer',
      csrfSecret,
      allowedOrigins: [origin],
    }),
});

function csrf(token: string) {
  return createHmac('sha256', csrfSecret).update(`ligimed:csrf:v1:${token}`).digest('base64url');
}

async function dealerClient(status: 'ACTIVE' | 'PENDING' = 'ACTIVE') {
  const organizationId = randomUUID();
  const userId = randomUUID();
  organizationIds.push(organizationId);
  userIds.push(userId);
  const membership = await database.membership.create({
    data: {
      user: { create: { id: userId, displayName: 'Catalogue dealer owner' } },
      organization: {
        create: {
          id: organizationId,
          type: 'DEALER',
          status,
          legalName: 'Catalogue Dealer Private Limited',
          slug: `catalogue-dealer-${organizationId}`,
        },
      },
      status: 'ACTIVE',
      joinedAt: new Date(),
      roles: { create: { role: { connect: { key: 'DEALER_ADMIN' } } } },
    },
  });
  const session = await sessions.create({
    userId,
    membershipId: membership.id,
    organizationId,
    scope: status === 'ACTIVE' ? 'FULL' : 'ONBOARDING',
  });
  return {
    organizationId,
    cookie: `ligimed_session_dealer=${session.token}`,
    csrf: csrf(session.token),
  };
}

beforeAll(async () => {
  const role = await database.role.findUnique({
    where: { key: 'DEALER_ADMIN' },
    include: { permissions: { include: { permission: true } } },
  });
  expect(role?.permissions.some(({ permission }) => permission.key === 'catalogue.manage')).toBe(
    true,
  );
});

afterAll(async () => {
  try {
    await database.outboxEvent.deleteMany({ where: { aggregateId: { in: listingIds } } });
    await database.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await database.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await database.product.deleteMany({ where: { id: { in: productIds } } });
    await database.manufacturer.deleteMany({ where: { id: { in: manufacturerIds } } });
    await database.productCategory.deleteMany({ where: { id: { in: categoryIds } } });
    await database.user.deleteMany({ where: { id: { in: userIds } } });
  } finally {
    await app.close();
    await database.$disconnect();
  }
});

describe('dealer catalogue publication', () => {
  it('requires an authenticated active dealer with full access', async () => {
    expect((await app.inject({ url: '/api/v1/dealer/catalogue/listings' })).statusCode).toBe(401);
    const pending = await dealerClient('PENDING');
    expect(
      (
        await app.inject({
          url: '/api/v1/dealer/catalogue/listings',
          headers: { cookie: pending.cookie },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('creates, reads, updates and tenant-scopes a medicine listing', async () => {
    const owner = await dealerClient();
    const otherDealer = await dealerClient();
    const unique = randomUUID().slice(0, 8);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/dealer/catalogue/listings',
      headers: {
        cookie: owner.cookie,
        origin,
        'x-csrf-token': owner.csrf,
        'content-type': 'application/json',
      },
      payload: {
        name: `Paracetamol ${unique}`,
        genericName: 'Paracetamol',
        strength: '500 mg',
        dosageForm: 'Tablet',
        packSize: '10 tablets',
        manufacturerName: `Test Manufacturer ${unique}`,
        categoryName: `Analgesics ${unique}`,
        description: 'Database-backed integration test medicine.',
        sku: `PCM-${unique}`,
        unitPriceMinor: '1250',
        minimumQuantity: 2,
        isAvailable: true,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const listing = created.json<{
      listingId: string;
      id: string;
      unitPrice: { amountMinor: string };
    }>();
    listingIds.push(listing.listingId);
    productIds.push(listing.id);
    const product = await database.product.findUniqueOrThrow({
      where: { id: listing.id },
      select: { manufacturerId: true, categoryId: true },
    });
    if (product.manufacturerId) manufacturerIds.push(product.manufacturerId);
    if (product.categoryId) categoryIds.push(product.categoryId);
    expect(listing.unitPrice.amountMinor).toBe('1250');

    const ownDetail = await app.inject({
      url: `/api/v1/dealer/catalogue/listings/${listing.listingId}`,
      headers: { cookie: owner.cookie },
    });
    expect(ownDetail.statusCode, ownDetail.body).toBe(200);
    const crossTenant = await app.inject({
      url: `/api/v1/dealer/catalogue/listings/${listing.listingId}`,
      headers: { cookie: otherDealer.cookie },
    });
    expect(crossTenant.statusCode).toBe(404);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/dealer/catalogue/listings/${listing.listingId}`,
      headers: {
        cookie: owner.cookie,
        origin,
        'x-csrf-token': owner.csrf,
        'content-type': 'application/json',
      },
      payload: {
        sku: `PCM-${unique}-NEW`,
        unitPriceMinor: '1400',
        currency: 'INR',
        minimumQuantity: 5,
        isAvailable: false,
      },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json()).toMatchObject({
      listingId: listing.listingId,
      minimumQuantity: 5,
      isAvailable: false,
      unitPrice: { amountMinor: '1400', currency: 'INR' },
    });
    expect(
      await database.auditLog.count({
        where: {
          organizationId: owner.organizationId,
          action: { in: ['dealer.catalogue_listing_created', 'dealer.catalogue_listing_updated'] },
        },
      }),
    ).toBe(2);
  });
});
