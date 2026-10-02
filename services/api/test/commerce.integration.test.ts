import { createHmac, randomUUID } from 'node:crypto';

import { createDatabaseClient, SessionRepository } from '@ligimed/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApi } from '../src/app.js';
import { registerCommerce } from '../src/modules/commerce/commerce-routes.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('A live PostgreSQL database is required.');
const database = createDatabaseClient({ databaseUrl });
const sessions = new SessionRepository(database);
const csrfSecret = 'commerce-integration-csrf-secret-at-least-32-bytes';
const pharmacyOrigin = 'http://localhost:3000';
const dealerOrigin = 'http://localhost:3001';
const organizationIds: string[] = [];
const userIds: string[] = [];
const productIds: string[] = [];
const listingIds: string[] = [];
const orderIds: string[] = [];

const app = await buildApi({
  logger: false,
  configuration: {
    environment: 'test',
    allowedOrigins: [pharmacyOrigin, dealerOrigin],
    logLevel: 'info',
    trustProxy: false,
  },
  registerRoutes: (api) =>
    registerCommerce(api, {
      database,
      pharmacyCookieName: 'ligimed_session',
      dealerCookieName: 'ligimed_session_dealer',
      csrfSecret,
      allowedOrigins: [pharmacyOrigin, dealerOrigin],
    }),
});

function csrf(token: string) {
  return createHmac('sha256', csrfSecret).update(`ligimed:csrf:v1:${token}`).digest('base64url');
}

async function organization(type: 'PHARMACY' | 'DEALER', name: string) {
  const organizationId = randomUUID();
  const userId = randomUUID();
  organizationIds.push(organizationId);
  userIds.push(userId);
  const membership = await database.membership.create({
    data: {
      user: { create: { id: userId, displayName: `${name} operator` } },
      organization: {
        create: {
          id: organizationId,
          type,
          status: 'ACTIVE',
          legalName: name,
          slug: `commerce-${type.toLowerCase()}-${organizationId}`,
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
  if (type === 'PHARMACY') {
    const address = await database.address.create({
      data: {
        organizationId,
        name: 'Main pharmacy',
        line1: '1 Health Street',
        city: 'Bengaluru',
        district: 'Bengaluru Urban',
        state: 'Karnataka',
        stateCode: 'KA',
        postalCode: '560001',
      },
    });
    await database.pharmacyProfile.create({
      data: { organizationId, primaryAddressId: address.id },
    });
  } else {
    await database.dealerPublicProfile.create({
      data: { organizationId, city: 'Bengaluru', state: 'Karnataka', serviceAreas: ['Bengaluru'] },
    });
    await database.kycRecord.create({
      data: {
        organizationId,
        revision: 1,
        status: 'VERIFIED',
        authorizedRepresentativeName: `${name} operator`,
        reviewedAt: new Date(),
        createdById: userId,
        updatedById: userId,
      },
    });
  }
  const session = await sessions.create({
    userId,
    membershipId: membership.id,
    organizationId,
    scope: 'FULL',
  });
  return {
    organizationId,
    userId,
    cookie: `${type === 'PHARMACY' ? 'ligimed_session' : 'ligimed_session_dealer'}=${session.token}`,
    csrf: csrf(session.token),
  };
}

async function listing(dealerId: string, name: string, minimumQuantity = 2) {
  const product = await database.product.create({
    data: { name, genericName: 'Test generic', strength: '500 mg', dosageForm: 'Tablet' },
  });
  productIds.push(product.id);
  const item = await database.dealerCatalogueItem.create({
    data: {
      organizationId: dealerId,
      productId: product.id,
      sku: `SKU-${randomUUID().slice(0, 8)}`,
      unitPriceMinor: 1250n,
      minimumQuantity,
    },
  });
  listingIds.push(item.id);
  return item;
}

beforeAll(async () => {
  const permissions = await database.role.findMany({
    where: { key: { in: ['PHARMACY_ADMIN', 'DEALER_ADMIN'] } },
    include: { permissions: { include: { permission: true } } },
  });
  expect(
    permissions
      .find((role) => role.key === 'PHARMACY_ADMIN')
      ?.permissions.some(({ permission }) => permission.key === 'order.create'),
  ).toBe(true);
  expect(
    permissions
      .find((role) => role.key === 'DEALER_ADMIN')
      ?.permissions.some(({ permission }) => permission.key === 'order.manage'),
  ).toBe(true);
});

afterAll(async () => {
  try {
    await database.outboxEvent.deleteMany({ where: { aggregateId: { in: orderIds } } });
    await database.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await database.order.deleteMany({ where: { id: { in: orderIds } } });
    await database.cart.deleteMany({ where: { pharmacyOrganizationId: { in: organizationIds } } });
    await database.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await database.product.deleteMany({ where: { id: { in: productIds } } });
    await database.user.deleteMany({ where: { id: { in: userIds } } });
  } finally {
    await app.close();
    await database.$disconnect();
  }
});

describe('PH1.9 cart, checkout and order history', () => {
  it('requires an authenticated full pharmacy session', async () => {
    expect((await app.inject({ url: '/api/v1/pharmacy/commerce/cart' })).statusCode).toBe(401);
  });

  it('enforces minimum quantity and one dealer per cart', async () => {
    const pharmacy = await organization('PHARMACY', 'Cart Pharmacy');
    const firstDealer = await organization('DEALER', 'First Dealer');
    const secondDealer = await organization('DEALER', 'Second Dealer');
    const first = await listing(firstDealer.organizationId, 'Cart tablet');
    const second = await listing(secondDealer.organizationId, 'Other tablet');
    const tooSmall = await app.inject({
      method: 'PUT',
      url: `/api/v1/pharmacy/commerce/cart/items/${first.id}`,
      headers: {
        cookie: pharmacy.cookie,
        origin: pharmacyOrigin,
        'x-csrf-token': pharmacy.csrf,
        'content-type': 'application/json',
      },
      payload: { quantity: 1 },
    });
    expect(tooSmall.statusCode).toBe(422);
    const added = await app.inject({
      method: 'PUT',
      url: `/api/v1/pharmacy/commerce/cart/items/${first.id}`,
      headers: {
        cookie: pharmacy.cookie,
        origin: pharmacyOrigin,
        'x-csrf-token': pharmacy.csrf,
        'content-type': 'application/json',
      },
      payload: { quantity: 3 },
    });
    expect(added.statusCode, added.body).toBe(200);
    expect(added.json()).toMatchObject({
      cart: { dealer: { id: firstDealer.organizationId }, itemCount: 3 },
    });
    const conflict = await app.inject({
      method: 'PUT',
      url: `/api/v1/pharmacy/commerce/cart/items/${second.id}`,
      headers: {
        cookie: pharmacy.cookie,
        origin: pharmacyOrigin,
        'x-csrf-token': pharmacy.csrf,
        'content-type': 'application/json',
      },
      payload: { quantity: 2 },
    });
    expect(conflict.statusCode).toBe(409);
  });

  it('checks out immutable snapshots and scopes order access to both parties', async () => {
    const pharmacy = await organization('PHARMACY', 'Checkout Pharmacy');
    const otherPharmacy = await organization('PHARMACY', 'Other Pharmacy');
    const dealer = await organization('DEALER', 'Checkout Dealer');
    const item = await listing(dealer.organizationId, 'Checkout tablet');
    const headers = {
      cookie: pharmacy.cookie,
      origin: pharmacyOrigin,
      'x-csrf-token': pharmacy.csrf,
      'content-type': 'application/json',
    };
    await app.inject({
      method: 'PUT',
      url: `/api/v1/pharmacy/commerce/cart/items/${item.id}`,
      headers,
      payload: { quantity: 4 },
    });
    const checkout = await app.inject({
      method: 'POST',
      url: '/api/v1/pharmacy/commerce/cart/checkout',
      headers,
      payload: { paymentMethod: 'CASH_ON_DELIVERY' },
    });
    expect(checkout.statusCode, checkout.body).toBe(201);
    const order = checkout.json<{ id: string; status: string; items: Array<{ name: string }> }>();
    orderIds.push(order.id);
    expect(order).toMatchObject({
      status: 'PENDING',
      paymentMethod: 'CASH_ON_DELIVERY',
      paymentStatus: 'PENDING',
      items: [{ name: 'Checkout tablet' }],
    });
    expect(
      (
        await app.inject({
          url: '/api/v1/pharmacy/commerce/cart',
          headers: { cookie: pharmacy.cookie },
        })
      ).json(),
    ).toEqual({ cart: null });
    expect(
      (
        await app.inject({
          url: `/api/v1/pharmacy/commerce/orders/${order.id}`,
          headers: { cookie: otherPharmacy.cookie },
        })
      ).statusCode,
    ).toBe(404);
    const dealerRead = await app.inject({
      url: `/api/v1/dealer/commerce/orders/${order.id}`,
      headers: { cookie: dealer.cookie },
    });
    expect(dealerRead.statusCode, dealerRead.body).toBe(200);
    expect(
      await database.auditLog.count({
        where: { organizationId: pharmacy.organizationId, action: 'pharmacy.order_placed' },
      }),
    ).toBe(1);
    expect(
      await database.outboxEvent.count({
        where: { aggregateId: order.id, eventType: 'order.placed' },
      }),
    ).toBe(1);
  });

  it('enforces dealer status transitions and appends history', async () => {
    const pharmacy = await organization('PHARMACY', 'History Pharmacy');
    const dealer = await organization('DEALER', 'History Dealer');
    const item = await listing(dealer.organizationId, 'History tablet', 1);
    await app.inject({
      method: 'PUT',
      url: `/api/v1/pharmacy/commerce/cart/items/${item.id}`,
      headers: {
        cookie: pharmacy.cookie,
        origin: pharmacyOrigin,
        'x-csrf-token': pharmacy.csrf,
        'content-type': 'application/json',
      },
      payload: { quantity: 1 },
    });
    const checkout = await app.inject({
      method: 'POST',
      url: '/api/v1/pharmacy/commerce/cart/checkout',
      headers: {
        cookie: pharmacy.cookie,
        origin: pharmacyOrigin,
        'x-csrf-token': pharmacy.csrf,
        'content-type': 'application/json',
      },
      payload: { paymentMethod: 'BANK_TRANSFER' },
    });
    const orderId = checkout.json<{ id: string }>().id;
    orderIds.push(orderId);
    const invalid = await app.inject({
      method: 'PATCH',
      url: `/api/v1/dealer/commerce/orders/${orderId}/status`,
      headers: {
        cookie: dealer.cookie,
        origin: dealerOrigin,
        'x-csrf-token': dealer.csrf,
        'content-type': 'application/json',
      },
      payload: { status: 'DELIVERED', note: '' },
    });
    expect(invalid.statusCode).toBe(409);
    const confirmed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/dealer/commerce/orders/${orderId}/status`,
      headers: {
        cookie: dealer.cookie,
        origin: dealerOrigin,
        'x-csrf-token': dealer.csrf,
        'content-type': 'application/json',
      },
      payload: { status: 'CONFIRMED', note: 'Stock reserved' },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json()).toMatchObject({
      status: 'CONFIRMED',
      statusHistory: [
        { fromStatus: null, toStatus: 'PENDING' },
        { fromStatus: 'PENDING', toStatus: 'CONFIRMED', note: 'Stock reserved' },
      ],
    });
  });
});
