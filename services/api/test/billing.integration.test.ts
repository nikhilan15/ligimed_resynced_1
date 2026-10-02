import { createHmac, randomUUID } from 'node:crypto';

import { createDatabaseClient, SessionRepository } from '@ligimed/database';
import {
  invoiceDetailSchema,
  retailDraftSchema,
  retailDraftListSchema,
  customerPurchaseHistorySchema,
} from '@ligimed/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApi } from '../src/app.js';
import { registerBilling } from '../src/modules/billing/billing-routes.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('A live PostgreSQL database is required.');
const database = createDatabaseClient({ databaseUrl });
const sessions = new SessionRepository(database);
const csrfSecret = 'billing-integration-csrf-secret-at-least-32-bytes';
const origin = 'http://localhost:3000';
const ids = {
  pharmacy: randomUUID(),
  otherPharmacy: randomUUID(),
  dealer: randomUUID(),
  user: randomUUID(),
  otherUser: randomUUID(),
  product: randomUUID(),
  invoice: '',
  order: randomUUID(),
};
let pharmacy: { cookie: string; csrf: string };
let other: { cookie: string; csrf: string };
let customerId: string;
let otherCustomerId: string;
let batchId: string;

const app = await buildApi({
  logger: false,
  configuration: {
    environment: 'test',
    allowedOrigins: [origin],
    logLevel: 'info',
    trustProxy: false,
  },
  registerRoutes: (api) =>
    registerBilling(api, {
      database,
      cookieName: 'ligimed_session',
      csrfSecret,
      allowedOrigins: [origin],
    }),
});

async function makePharmacy(organizationId: string, userId: string) {
  const membership = await database.membership.create({
    data: {
      user: { create: { id: userId, displayName: 'Billing test user' } },
      organization: {
        create: {
          id: organizationId,
          type: 'PHARMACY',
          status: 'ACTIVE',
          legalName: 'Billing test pharmacy',
          slug: `billing-test-${organizationId}`,
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
    scope: 'FULL',
  });
  return {
    cookie: `ligimed_session=${session.token}`,
    csrf: createHmac('sha256', csrfSecret)
      .update(`ligimed:csrf:v1:${session.token}`)
      .digest('base64url'),
  };
}

beforeAll(async () => {
  pharmacy = await makePharmacy(ids.pharmacy, ids.user);
  other = await makePharmacy(ids.otherPharmacy, ids.otherUser);
  await database.organization.create({
    data: {
      id: ids.dealer,
      type: 'DEALER',
      status: 'ACTIVE',
      legalName: 'Billing test dealer',
      slug: `billing-dealer-${ids.dealer}`,
    },
  });
  const customer = await database.customer.create({
    data: { organizationId: ids.pharmacy, displayName: 'Billing test customer' },
  });
  customerId = customer.id;
  const otherCustomer = await database.customer.create({
    data: { organizationId: ids.otherPharmacy, displayName: 'Other billing customer' },
  });
  otherCustomerId = otherCustomer.id;
  await database.product.create({ data: { id: ids.product, name: 'Billing test medicine' } });
  const item = await database.inventoryItem.create({
    data: { organizationId: ids.pharmacy, productId: ids.product },
  });
  const batch = await database.inventoryBatch.create({
    data: {
      inventoryItemId: item.id,
      batchNumber: 'BILLING-TEST-1',
      quantityOnHand: 5,
      expiresAt: new Date('2030-12-31T00:00:00.000Z'),
    },
  });
  batchId = batch.id;
  await database.order.create({
    data: {
      id: ids.order,
      orderNumber: `LM-BILLING-${randomUUID().slice(0, 8)}`,
      pharmacyOrganizationId: ids.pharmacy,
      dealerOrganizationId: ids.dealer,
      placedByUserId: ids.user,
      status: 'DELIVERED',
      paymentMethod: 'BANK_TRANSFER',
      subtotalMinor: 1500n,
      totalMinor: 1500n,
      shippingAddress: {},
      items: {
        create: {
          productId: ids.product,
          productName: 'Billing test medicine',
          unitPriceMinor: 1500n,
          quantity: 1,
          lineTotalMinor: 1500n,
        },
      },
    },
  });
});

afterAll(async () => {
  try {
    const invoiceIds = (
      await database.invoice.findMany({
        where: { pharmacyOrganizationId: ids.pharmacy },
        select: { id: true },
      })
    ).map((invoice) => invoice.id);
    await database.outboxEvent.deleteMany({ where: { aggregateId: { in: invoiceIds } } });
    await database.auditLog.deleteMany({
      where: { actorUserId: { in: [ids.user, ids.otherUser] } },
    });
    await database.retailBillDraft.deleteMany({ where: { organizationId: ids.pharmacy } });
    await database.invoicePaymentEntry.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await database.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await database.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await database.stockMovement.deleteMany({ where: { createdById: ids.user } });
    await database.order.delete({ where: { id: ids.order } });
    await database.inventoryBatch.delete({ where: { id: batchId } });
    await database.inventoryItem.deleteMany({ where: { organizationId: ids.pharmacy } });
    await database.customer.delete({ where: { id: customerId } });
    await database.customer.delete({ where: { id: otherCustomerId } });
    await database.product.delete({ where: { id: ids.product } });
    await database.organization.deleteMany({
      where: { id: { in: [ids.pharmacy, ids.otherPharmacy, ids.dealer] } },
    });
    await database.user.deleteMany({ where: { id: { in: [ids.user, ids.otherUser] } } });
  } finally {
    await app.close();
    await database.$disconnect();
  }
});

describe('pharmacy billing', () => {
  it('rejects unauthenticated and CSRF-free requests', async () => {
    expect((await app.inject({ url: '/api/v1/pharmacy/billing' })).statusCode).toBe(401);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pharmacy/billing/retail-sales',
      headers: { cookie: pharmacy.cookie, origin, 'content-type': 'application/json' },
      payload: { idempotencyKey: randomUUID(), customerId, lines: [] },
    });
    expect(response.statusCode).toBe(403);
  });

  it('records one sale, deducts stock once on retry, and isolates other pharmacies', async () => {
    const payload = {
      idempotencyKey: randomUUID(),
      customerId,
      lines: [{ batchId, quantity: 2, unitPriceMinor: '1000', taxMinor: '50' }],
    };
    const headers = {
      cookie: pharmacy.cookie,
      origin,
      'x-csrf-token': pharmacy.csrf,
      'content-type': 'application/json',
    };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/pharmacy/billing/retail-sales',
      headers,
      payload,
    });
    expect(first.statusCode, first.body).toBe(201);
    const firstInvoice = invoiceDetailSchema.parse(first.json());
    ids.invoice = firstInvoice.id;
    expect(firstInvoice).toMatchObject({ type: 'RETAIL_SALE', total: { amountMinor: '2050' } });
    const retry = await app.inject({
      method: 'POST',
      url: '/api/v1/pharmacy/billing/retail-sales',
      headers,
      payload,
    });
    expect(retry.statusCode, retry.body).toBe(201);
    expect(invoiceDetailSchema.parse(retry.json()).id).toBe(ids.invoice);
    expect(
      (await database.inventoryBatch.findUniqueOrThrow({ where: { id: batchId } })).quantityOnHand,
    ).toBe(3);
    const forbidden = await app.inject({
      url: `/api/v1/pharmacy/billing/${ids.invoice}`,
      headers: { cookie: other.cookie },
    });
    expect(forbidden.statusCode).toBe(404);
  });

  it('rejects a batch owned by another pharmacy', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pharmacy/billing/retail-sales',
      headers: {
        cookie: other.cookie,
        origin,
        'x-csrf-token': other.csrf,
        'content-type': 'application/json',
      },
      payload: {
        idempotencyKey: randomUUID(),
        customerId: otherCustomerId,
        lines: [{ batchId, quantity: 1, unitPriceMinor: '1000', taxMinor: '0' }],
      },
    });
    expect(response.statusCode).toBe(404);
    expect(
      (await database.inventoryBatch.findUniqueOrThrow({ where: { id: batchId } })).quantityOnHand,
    ).toBe(3);
  });

  it('keeps offline payments and refunds tenant-scoped, balanced, and retry-safe', async () => {
    const url = `/api/v1/pharmacy/billing/${ids.invoice}/payment-entries`;
    const headers = {
      cookie: pharmacy.cookie,
      origin,
      'x-csrf-token': pharmacy.csrf,
      'content-type': 'application/json',
    };
    const payload = {
      idempotencyKey: randomUUID(),
      type: 'PAYMENT',
      method: 'CASH',
      amountMinor: '1500',
      reference: null,
      occurredAt: new Date().toISOString(),
    };
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { cookie: pharmacy.cookie, origin, 'content-type': 'application/json' },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { ...headers, cookie: other.cookie, 'x-csrf-token': other.csrf },
          payload,
        })
      ).statusCode,
    ).toBe(404);
    const created = await app.inject({ method: 'POST', url, headers, payload });
    expect(created.statusCode, created.body).toBe(201);
    expect(invoiceDetailSchema.parse(created.json()).paymentLedger).toMatchObject({
      status: 'PARTIAL',
      recordedNet: { amountMinor: '1500' },
      remaining: { amountMinor: '550' },
    });
    const retry = await app.inject({ method: 'POST', url, headers, payload });
    expect(retry.statusCode, retry.body).toBe(201);
    expect(invoiceDetailSchema.parse(retry.json()).paymentLedger.entries).toHaveLength(1);
    const overpayment = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: { ...payload, idempotencyKey: randomUUID(), amountMinor: '551' },
    });
    expect(overpayment.statusCode).toBe(422);
    const refund = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: { ...payload, idempotencyKey: randomUUID(), type: 'REFUND', amountMinor: '500' },
    });
    expect(refund.statusCode, refund.body).toBe(201);
    expect(invoiceDetailSchema.parse(refund.json()).paymentLedger).toMatchObject({
      recordedNet: { amountMinor: '1000' },
      remaining: { amountMinor: '1050' },
    });
    expect(
      (await database.invoicePaymentEntry.count({ where: { invoiceId: ids.invoice } })).toString(),
    ).toBe('2');
  });

  it('persists tenant-scoped drafts, records discounted sales once, and exposes customer history', async () => {
    const headers = {
      cookie: pharmacy.cookie,
      origin,
      'x-csrf-token': pharmacy.csrf,
      'content-type': 'application/json',
    };
    const lines = [
      { batchId, quantity: 1, unitPriceMinor: '1200', discountMinor: '200', taxMinor: '0' },
    ];
    const saved = await app.inject({
      method: 'POST',
      url: '/api/v1/pharmacy/billing/drafts',
      headers,
      payload: { customerId, lines },
    });
    expect(saved.statusCode, saved.body).toBe(201);
    const draft = retailDraftSchema.parse(saved.json());
    expect(draft.total.amountMinor).toBe('1000');
    expect(
      retailDraftListSchema
        .parse(
          (
            await app.inject({
              url: '/api/v1/pharmacy/billing/drafts',
              headers: { cookie: pharmacy.cookie },
            })
          ).json(),
        )
        .drafts.some((item) => item.id === draft.id),
    ).toBe(true);
    expect(
      (
        await app.inject({
          url: `/api/v1/pharmacy/billing/drafts/${draft.id}`,
          headers: { cookie: other.cookie },
        })
      ).statusCode,
    ).toBe(404);
    const sale = await app.inject({
      method: 'POST',
      url: '/api/v1/pharmacy/billing/retail-sales',
      headers,
      payload: { draftId: draft.id, idempotencyKey: randomUUID(), customerId, lines },
    });
    expect(sale.statusCode, sale.body).toBe(201);
    expect(invoiceDetailSchema.parse(sale.json())).toMatchObject({
      total: { amountMinor: '1000' },
      discount: { amountMinor: '200' },
    });
    expect(
      (
        await app.inject({
          url: `/api/v1/pharmacy/billing/drafts/${draft.id}`,
          headers: { cookie: pharmacy.cookie },
        })
      ).statusCode,
    ).toBe(404);
    const history = customerPurchaseHistorySchema.parse(
      (
        await app.inject({
          url: `/api/v1/pharmacy/billing/customers/${customerId}/history`,
          headers: { cookie: pharmacy.cookie },
        })
      ).json(),
    );
    expect(history.purchaseCount).toBe(2);
    expect(history.recent[0]?.total.amountMinor).toBe('1000');
  });

  it('records a dealer-supplied purchase invoice against its delivered order', async () => {
    const payload = {
      orderId: ids.order,
      referenceNumber: `DEALER-${randomUUID().slice(0, 8)}`,
      issuedAt: '2026-09-01',
      subtotalMinor: '1500',
      taxMinor: '0',
      deliveryChargeMinor: '0',
    };
    const headers = {
      cookie: pharmacy.cookie,
      origin,
      'x-csrf-token': pharmacy.csrf,
      'content-type': 'application/json',
    };
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/pharmacy/billing/dealer-purchases',
      headers,
      payload,
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      type: 'DEALER_PURCHASE',
      reconciliation: 'MATCHED',
      orderItems: [{ productName: 'Billing test medicine' }],
    });
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/pharmacy/billing/dealer-purchases',
      headers,
      payload,
    });
    expect(duplicate.statusCode).toBe(409);
  });
});
