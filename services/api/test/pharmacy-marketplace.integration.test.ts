import { randomUUID } from 'node:crypto';

import { createDatabaseClient, SessionRepository } from '@ligimed/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApi } from '../src/app.js';
import { registerPharmacyMarketplace } from '../src/modules/marketplace/pharmacy-marketplace-routes.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('A live PostgreSQL database is required.');
const database = createDatabaseClient({ databaseUrl });
const sessions = new SessionRepository(database);
const origin = 'http://localhost:3000';
const organizationIds: string[] = [];
const userIds: string[] = [];
const productIds: string[] = [];
const app = await buildApi({
  logger: false,
  configuration: {
    environment: 'test',
    allowedOrigins: [origin],
    logLevel: 'info',
    trustProxy: false,
  },
  registerRoutes: (api) =>
    registerPharmacyMarketplace(api, {
      database,
      cookieName: 'ligimed_session',
      csrfSecret: 'integration-csrf-secret-at-least-32-bytes',
      allowedOrigins: [origin],
    }),
});

async function pharmacyClient(status: 'PENDING' | 'ACTIVE' = 'ACTIVE') {
  const organizationId = randomUUID();
  const userId = randomUUID();
  organizationIds.push(organizationId);
  userIds.push(userId);
  const membership = await database.membership.create({
    data: {
      user: { create: { id: userId, displayName: 'Marketplace Pharmacy Owner' } },
      organization: {
        create: {
          id: organizationId,
          type: 'PHARMACY',
          status,
          legalName: 'Marketplace Pharmacy',
          slug: `market-pharmacy-${organizationId}`,
        },
      },
      status: 'ACTIVE',
      joinedAt: new Date(),
      roles: { create: { role: { connect: { key: 'PHARMACY_ADMIN' } } } },
    },
  });
  const session = await sessions.create({
    userId,
    membershipId: membership.id,
    organizationId,
    scope: status === 'ACTIVE' ? 'FULL' : 'ONBOARDING',
  });
  return { cookie: `ligimed_session=${session.token}` };
}

async function dealer(options: {
  name: string;
  organizationStatus?: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  kycStatus?: 'SUBMITTED' | 'VERIFIED' | 'REJECTED';
  publicProfile?: boolean;
  city?: string;
}) {
  const organizationId = randomUUID();
  const userId = randomUUID();
  organizationIds.push(organizationId);
  userIds.push(userId);
  await database.user.create({
    data: { id: userId, displayName: `${options.name} Owner` },
  });
  await database.organization.create({
    data: {
      id: organizationId,
      type: 'DEALER',
      status: options.organizationStatus ?? 'ACTIVE',
      legalName: `${options.name} Private Limited`,
      tradeName: options.name,
      slug: `market-dealer-${organizationId}`,
      memberships: {
        create: {
          user: { connect: { id: userId } },
          status: 'ACTIVE',
          joinedAt: new Date(),
          roles: { create: { role: { connect: { key: 'DEALER_ADMIN' } } } },
        },
      },
      ...(options.publicProfile === false
        ? {}
        : {
            dealerPublicProfile: {
              create: {
                summary: 'Regional pharmaceutical distribution partner.',
                city: options.city ?? 'Bengaluru',
                state: 'Karnataka',
                serviceAreas: ['Bengaluru Urban', 'Mysuru'],
              },
            },
          }),
      kycRecords: {
        create: {
          revision: 1,
          status: options.kycStatus ?? 'VERIFIED',
          authorizedRepresentativeName: `${options.name} Owner`,
          submittedAt: new Date(),
          reviewedAt: options.kycStatus === 'SUBMITTED' ? null : new Date(),
          createdById: userId,
          updatedById: userId,
        },
      },
    },
  });
  return organizationId;
}

beforeAll(async () => {
  expect(await database.role.findUnique({ where: { key: 'PHARMACY_ADMIN' } })).not.toBeNull();
});

afterAll(async () => {
  try {
    await database.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await database.product.deleteMany({ where: { id: { in: productIds } } });
    await database.user.deleteMany({ where: { id: { in: userIds } } });
  } finally {
    await app.close();
    await database.$disconnect();
  }
});

describe('PH1.4 verified dealer marketplace', () => {
  it('requires an authenticated, active pharmacy with full access', async () => {
    expect((await app.inject({ url: '/api/v1/pharmacy/marketplace/dealers' })).statusCode).toBe(
      401,
    );
    const pending = await pharmacyClient('PENDING');
    expect(
      (
        await app.inject({
          url: '/api/v1/pharmacy/marketplace/dealers',
          headers: { cookie: pending.cookie },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('returns only active dealers with a public profile and latest verified KYC', async () => {
    const pharmacy = await pharmacyClient();
    const visibleId = await dealer({ name: 'Visible Health Distributors' });
    await dealer({ name: 'Pending Dealer', kycStatus: 'SUBMITTED' });
    await dealer({ name: 'Suspended Dealer', organizationStatus: 'SUSPENDED' });
    await dealer({ name: 'Private Dealer', publicProfile: false });

    const response = await app.inject({
      url: '/api/v1/pharmacy/marketplace/dealers',
      headers: { cookie: pharmacy.cookie },
    });
    expect(response.statusCode, response.body).toBe(200);
    const visible = response
      .json<{ dealers: Array<Record<string, unknown> & { id: string }> }>()
      .dealers.find((item) => item.id === visibleId);
    expect(visible).toMatchObject({
      id: visibleId,
      name: 'Visible Health Distributors',
      verificationStatus: 'VERIFIED',
      location: { city: 'Bengaluru', state: 'Karnataka' },
      catalogue: { available: true },
    });
  });

  it('supports bounded search and cursor pagination without tenant selectors', async () => {
    const pharmacy = await pharmacyClient();
    const marker = randomUUID().slice(0, 8);
    const name = `Chennai Search Partner ${marker}`;
    await dealer({ name, city: 'Chennai' });
    const search = await app.inject({
      url: `/api/v1/pharmacy/marketplace/dealers?q=${marker}&limit=1`,
      headers: { cookie: pharmacy.cookie },
    });
    expect(search.statusCode, search.body).toBe(200);
    expect(search.json<{ dealers: Array<{ name: string }> }>().dealers[0]?.name).toBe(name);
    const tampered = await app.inject({
      url: `/api/v1/pharmacy/marketplace/dealers?organizationId=${randomUUID()}`,
      headers: { cookie: pharmacy.cookie },
    });
    expect(tampered.statusCode).toBe(422);
  });

  it('shows only published products for a currently verified dealer', async () => {
    const pharmacy = await pharmacyClient();
    const visibleDealerId = await dealer({ name: 'Catalogue Partner' });
    const otherDealerId = await dealer({ name: 'Other Catalogue Partner' });
    const hiddenDealerId = await dealer({
      name: 'Unverified Catalogue Partner',
      kycStatus: 'SUBMITTED',
    });
    const visibleProduct = await database.product.create({
      data: {
        name: 'Example tablet',
        genericName: 'Example generic',
        strength: '10 mg',
        dosageForm: 'Tablet',
      },
    });
    const otherProduct = await database.product.create({ data: { name: 'Other product' } });
    const inactiveProduct = await database.product.create({
      data: { name: 'Inactive product', isActive: false },
    });
    productIds.push(visibleProduct.id, otherProduct.id, inactiveProduct.id);
    const visibleListing = await database.dealerCatalogueItem.create({
      data: {
        organizationId: visibleDealerId,
        productId: visibleProduct.id,
        unitPriceMinor: 12500n,
        minimumQuantity: 2,
      },
    });
    await database.dealerCatalogueItem.createMany({
      data: [
        { organizationId: visibleDealerId, productId: inactiveProduct.id, unitPriceMinor: 100n },
        { organizationId: otherDealerId, productId: otherProduct.id, unitPriceMinor: 200n },
        { organizationId: hiddenDealerId, productId: visibleProduct.id, unitPriceMinor: 300n },
      ],
    });

    const response = await app.inject({
      url: `/api/v1/pharmacy/marketplace/dealers/${visibleDealerId}/catalogue?q=example&dosageForm=Tablet`,
      headers: { cookie: pharmacy.cookie },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(
      response.json<{ products: Array<{ id: string; unitPrice: { amountMinor: string } }> }>()
        .products,
    ).toMatchObject([{ id: visibleProduct.id, unitPrice: { amountMinor: '12500' } }]);
    expect(response.json<{ filters: { dosageForms: string[] } }>().filters.dosageForms).toContain(
      'Tablet',
    );
    const detail = await app.inject({
      url: `/api/v1/pharmacy/marketplace/dealers/${visibleDealerId}/catalogue/${visibleListing.id}`,
      headers: { cookie: pharmacy.cookie },
    });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json()).toMatchObject({
      dealer: { id: visibleDealerId },
      product: {
        listingId: visibleListing.id,
        id: visibleProduct.id,
        name: 'Example tablet',
        isAvailable: true,
      },
    });
    expect(
      (
        await app.inject({
          url: `/api/v1/pharmacy/marketplace/dealers/${hiddenDealerId}`,
          headers: { cookie: pharmacy.cookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          url: `/api/v1/pharmacy/marketplace/dealers/${visibleDealerId}/catalogue`,
        })
      ).statusCode,
    ).toBe(401);
  });
});
