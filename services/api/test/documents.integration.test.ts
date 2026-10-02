import { createHmac, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseClient, SessionRepository } from '@ligimed/database';
import { LocalPrivateObjectStorage, organizationObjectKey } from '@ligimed/storage';
import {
  documentCenterSchema,
  documentDetailSchema,
  adminDocumentCenterSchema,
} from '@ligimed/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApi } from '../src/app.js';
import { registerDocuments } from '../src/modules/documents/document-routes.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('A live PostgreSQL database is required.');
const database = createDatabaseClient({ databaseUrl });
const sessions = new SessionRepository(database);
const csrfSecret = 'documents-integration-secret-at-least-32-bytes';
const origin = 'http://localhost:3000';
const root = await mkdtemp(join(tmpdir(), 'ligimed-documents-'));
const storage = new LocalPrivateObjectStorage(root);
const organizationIds: string[] = [];
const userIds: string[] = [];
const docIds: string[] = [];
const roleKey = `DOCUMENT_TEST_${randomUUID()}`;
type Client = {
  organizationId: string;
  userId: string;
  sessionId: string;
  cookie: string;
  csrf: string;
};
let owner: Client;
let other: Client;
let admin: Client;
let restricted: Client;
let pending: Client;
let originalId: string;
let bankId: string;
let invoiceId: string;
let paymentId: string;
let orderId: string;
let kycId: string;
let dealerId: string;
const pdf = Buffer.from('%PDF-1.4\n%Integration fixture\n%%EOF');
const app = await buildApi({
  logger: false,
  configuration: {
    environment: 'test',
    allowedOrigins: [origin],
    logLevel: 'info',
    trustProxy: false,
  },
  registerRoutes: (api) =>
    registerDocuments(api, {
      database,
      storage,
      pharmacyCookieName: 'ligimed_session',
      adminCookieName: 'ligimed_session_admin',
      csrfSecret,
      allowedOrigins: [origin],
    }),
});

async function client(
  type: 'PHARMACY' | 'LIGIMED_INTERNAL',
  role: string,
  onboarding = false,
  organizationId?: string,
): Promise<Client> {
  const userId = randomUUID();
  const orgId = organizationId ?? randomUUID();
  userIds.push(userId);
  if (!organizationId) organizationIds.push(orgId);
  const membership = await database.membership.create({
    data: {
      user: { create: { id: userId, displayName: 'Documents test reviewer' } },
      organization: organizationId
        ? { connect: { id: orgId } }
        : {
            create: {
              id: orgId,
              type,
              status: onboarding ? 'PENDING' : 'ACTIVE',
              legalName: 'Documents test organization',
              slug: `documents-${orgId}`,
            },
          },
      status: 'ACTIVE',
      joinedAt: new Date(),
      roles: { create: { role: { connect: { key: role } } } },
    },
  });
  const session = await sessions.create({
    userId,
    membershipId: membership.id,
    organizationId: orgId,
    scope: onboarding ? 'ONBOARDING' : 'FULL',
  });
  return {
    organizationId: orgId,
    userId,
    sessionId: session.id,
    cookie: `${type === 'PHARMACY' ? 'ligimed_session' : 'ligimed_session_admin'}=${session.token}`,
    csrf: createHmac('sha256', csrfSecret)
      .update(`ligimed:csrf:v1:${session.token}`)
      .digest('base64url'),
  };
}
const headers = (user: Client) => ({ cookie: user.cookie, origin, 'x-csrf-token': user.csrf });
async function upload(input: Record<string, unknown>, user = owner, contents = pdf) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/pharmacy/documents/uploads',
    headers: {
      ...headers(user),
      'content-type': 'application/pdf',
      'x-file-name': encodeURIComponent('evidence.pdf'),
      'x-document-metadata': encodeURIComponent(
        JSON.stringify({
          idempotencyKey: randomUUID(),
          category: 'DRUG_LICENCE',
          title: 'Pharmacy drug licence',
          ...input,
        }),
      ),
    },
    payload: contents,
  });
  if (response.statusCode === 201) {
    const id = documentDetailSchema.parse(response.json()).id;
    if (!docIds.includes(id)) docIds.push(id);
  }
  return response;
}
const review = (id: string, input: Record<string, unknown>, user = admin) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/admin/documents/uploads/${id}/review`,
    headers: { ...headers(user), 'content-type': 'application/json' },
    payload: input,
  });

beforeAll(async () => {
  await database.role.create({
    data: {
      key: roleKey,
      name: 'Restricted document reader',
      organizationType: 'PHARMACY',
      permissions: {
        create: ['document.read', 'document.manage'].map((key) => ({
          permission: { connect: { key } },
        })),
      },
    },
  });
  owner = await client('PHARMACY', 'PHARMACY_ADMIN');
  other = await client('PHARMACY', 'PHARMACY_ADMIN');
  admin = await client('LIGIMED_INTERNAL', 'LIGIMED_COMPLIANCE');
  restricted = await client('PHARMACY', roleKey, false, owner.organizationId);
  pending = await client('PHARMACY', 'PHARMACY_ADMIN', true);
  dealerId = randomUUID();
  organizationIds.push(dealerId);
  await database.organization.create({
    data: {
      id: dealerId,
      type: 'DEALER',
      status: 'ACTIVE',
      legalName: 'Documents test dealer',
      slug: `documents-${dealerId}`,
    },
  });
  const order = await database.order.create({
    data: {
      pharmacyOrganizationId: owner.organizationId,
      dealerOrganizationId: dealerId,
      placedByUserId: owner.userId,
      orderNumber: `DOC-${randomUUID()}`,
      paymentMethod: 'BANK_TRANSFER',
      subtotalMinor: 1000n,
      totalMinor: 1000n,
      shippingAddress: {},
    },
  });
  orderId = order.id;
  const invoice = await database.invoice.create({
    data: {
      pharmacyOrganizationId: owner.organizationId,
      type: 'DEALER_PURCHASE',
      externalIssuedAt: new Date(),
      referenceNumber: `DOC-${randomUUID()}`,
      counterpartyName: 'Documents test dealer',
      orderId,
      dealerOrganizationId: dealerId,
      subtotalMinor: 1000n,
      taxMinor: 0n,
      totalMinor: 1000n,
      recordedById: owner.userId,
    },
  });
  invoiceId = invoice.id;
  const payment = await database.invoicePaymentEntry.create({
    data: {
      invoiceId,
      idempotencyKey: randomUUID(),
      type: 'PAYMENT',
      method: 'CASH',
      amountMinor: 1000n,
      occurredAt: new Date(),
      recordedById: owner.userId,
    },
  });
  paymentId = payment.id;
  const evidenceId = randomUUID();
  const objectKey = organizationObjectKey(owner.organizationId, evidenceId);
  const checksum = createHash('sha256').update(pdf).digest('hex');
  await storage.put(
    {
      organizationId: owner.organizationId,
      objectKey,
      contentType: 'application/pdf',
      contentLength: pdf.length,
      checksumSha256: checksum,
    },
    pdf,
  );
  await database.kycRecord.create({
    data: {
      organizationId: owner.organizationId,
      revision: 1,
      status: 'VERIFIED',
      authorizedRepresentativeName: 'Test owner',
      authorizedRepresentativeRole: 'Owner',
      createdById: owner.userId,
      updatedById: owner.userId,
      evidence: {
        create: {
          id: evidenceId,
          organizationId: owner.organizationId,
          category: 'PAN',
          status: 'VERIFIED',
          referenceNumber: 'ABCDE1234F',
          objectKey,
          originalFilename: 'kyc.pdf',
          contentType: 'application/pdf',
          contentLength: pdf.length,
          checksumSha256: checksum,
          uploadedById: owner.userId,
          expiresAt: new Date(Date.now() + 20 * 86400000),
        },
      },
    },
  });
  kycId = evidenceId;
});

afterAll(async () => {
  try {
    const documents = await database.document.findMany({
      where: { organizationId: { in: organizationIds } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    const allIds = [
      ...documents.map((item) => item.id),
      kycId,
      invoiceId,
      orderId,
      paymentId,
    ].filter(Boolean);
    await database.outboxEvent.deleteMany({ where: { aggregateId: { in: allIds } } });
    await database.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    const documentIds = documents.map((item) => item.id);
    await database.documentReminder.deleteMany({
      where: {
        OR: [
          { documentId: { in: documentIds } },
          { kycEvidence: { organizationId: { in: organizationIds } } },
        ],
      },
    });
    await database.documentReview.deleteMany({ where: { documentId: { in: documentIds } } });
    for (let remaining = documentIds.length; remaining > 0;) {
      const deleted = await database.document.deleteMany({
        where: { id: { in: documentIds }, replacement: null },
      });
      if (!deleted.count)
        throw new Error('Document fixture cleanup could not find a leaf version.');
      remaining -= deleted.count;
    }
    await database.invoicePaymentEntry.deleteMany({
      where: { invoice: { pharmacyOrganizationId: { in: organizationIds } } },
    });
    await database.invoice.deleteMany({
      where: { pharmacyOrganizationId: { in: organizationIds } },
    });
    await database.order.deleteMany({ where: { pharmacyOrganizationId: { in: organizationIds } } });
    await database.kycRecord.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await database.user.deleteMany({ where: { id: { in: userIds } } });
    await database.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await database.role.delete({ where: { key: roleKey } });
  } finally {
    await app.close();
    await database.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
});

describe('document and compliance center', () => {
  it('requires a live full session and CSRF for uploads', async () => {
    expect((await app.inject({ url: '/api/v1/pharmacy/documents/' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          url: '/api/v1/pharmacy/documents/',
          headers: { cookie: pending.cookie },
        })
      ).statusCode,
    ).toBe(403);
    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/pharmacy/documents/uploads',
      headers: { cookie: owner.cookie, 'content-type': 'application/pdf' },
      payload: pdf,
    });
    expect(result.statusCode).toBe(403);
  });
  it('validates content signatures, size, dates and metadata', async () => {
    expect((await upload({}, owner, Buffer.from('not-a-pdf'))).statusCode).toBe(422);
    expect((await upload({}, owner, Buffer.alloc(5_242_881))).statusCode).toBe(413);
    expect((await upload({ issuedAt: '2030-01-01', expiresAt: '2029-12-31' })).statusCode).toBe(
      422,
    );
    expect((await upload({ bankAccountLast4: '1234' })).statusCode).toBe(422);
    expect((await upload({ injected: 'not allowed' })).statusCode).toBe(422);
  });
  it('stores one upload across retries and rejects changed retry metadata', async () => {
    const input = {
      idempotencyKey: randomUUID(),
      expiresAt: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10),
    };
    const result = await upload(input);
    expect(result.statusCode, result.body).toBe(201);
    originalId = documentDetailSchema.parse(result.json()).id;
    expect(documentDetailSchema.parse((await upload(input)).json()).id).toBe(originalId);
    expect((await upload({ ...input, holderName: 'Changed holder' })).statusCode).toBe(409);
  });
  it('deduplicates simultaneous retries', async () => {
    const input = { idempotencyKey: randomUUID(), title: 'Concurrent document' };
    const results = await Promise.all([upload(input), upload(input)]);
    expect(results.map((result) => result.statusCode)).toEqual([201, 201]);
    expect(documentDetailSchema.parse(results[0].json()).id).toBe(
      documentDetailSchema.parse(results[1].json()).id,
    );
  });
  it('isolates tenant detail, file reads and links', async () => {
    for (const url of [
      `uploads/${originalId}`,
      `upload/${originalId}/content`,
      `kyc/${kycId}/content`,
      `invoice/${invoiceId}/content`,
      `order/${orderId}/content`,
      `payment/${paymentId}/content`,
    ])
      expect(
        (
          await app.inject({
            url: `/api/v1/pharmacy/documents/${url}`,
            headers: { cookie: other.cookie },
          })
        ).statusCode,
      ).toBe(404);
    expect((await upload({ orderId }, other)).statusCode).toBe(404);
    expect((await upload({ invoiceId }, other)).statusCode).toBe(404);
  });
  it('masks sensitive metadata and restricts banking and finance reads', async () => {
    const result = await upload({
      category: 'BANK_DOCUMENT',
      title: 'Bank verification',
      referenceNumber: '1234567891234',
      bankAccountLast4: '1234',
      bankIfsc: 'SBIN0001234',
    });
    expect(result.statusCode).toBe(201);
    bankId = documentDetailSchema.parse(result.json()).id;
    expect(documentDetailSchema.parse(result.json()).referenceNumber).toBe('••••1234');
    expect((await upload({ category: 'BANK_DOCUMENT' }, restricted)).statusCode).toBe(403);
    for (const path of [
      `uploads/${bankId}`,
      `upload/${bankId}/content`,
      `payment/${paymentId}/content`,
    ])
      expect(
        (
          await app.inject({
            url: `/api/v1/pharmacy/documents/${path}`,
            headers: { cookie: restricted.cookie },
          })
        ).statusCode,
      ).toBe(403);
    const center = documentCenterSchema.parse(
      (
        await app.inject({
          url: '/api/v1/pharmacy/documents/',
          headers: { cookie: restricted.cookie },
        })
      ).json(),
    );
    expect(
      center.documents.some((item) => item.group === 'BANKING' || item.group === 'FINANCE'),
    ).toBe(false);
  });
  it('returns private original bytes with attachment headers and audit events', async () => {
    const result = await app.inject({
      url: `/api/v1/pharmacy/documents/upload/${originalId}/content`,
      headers: { cookie: owner.cookie },
    });
    expect(result.statusCode).toBe(200);
    expect(result.rawPayload).toEqual(pdf);
    expect(result.headers['cache-control']).toContain('no-store');
    expect(result.headers['content-disposition']).toContain('attachment');
    expect(result.headers['content-security-policy']).toContain('sandbox');
    expect(
      await database.auditLog.count({
        where: { actorUserId: owner.userId, action: 'document.downloaded', resourceId: originalId },
      }),
    ).toBeGreaterThan(0);
  });
  it('projects existing KYC, orders, invoices and payment records without duplicates', async () => {
    const result = await app.inject({
      url: '/api/v1/pharmacy/documents/',
      headers: { cookie: owner.cookie },
    });
    expect(result.statusCode, result.body).toBe(200);
    const center = documentCenterSchema.parse(result.json());
    expect(center.documents.map((item) => item.source)).toEqual(
      expect.arrayContaining(['UPLOAD', 'KYC', 'ORDER', 'INVOICE', 'PAYMENT']),
    );
    expect(center.documents.find((item) => item.id === kycId)?.referenceNumber).toBe('••••234F');
    const filter = documentCenterSchema.parse(
      (
        await app.inject({
          url: '/api/v1/pharmacy/documents/?source=INVOICE&q=DOC-',
          headers: { cookie: owner.cookie },
        })
      ).json(),
    );
    expect(filter.documents).toHaveLength(1);
    expect(filter.documents[0]?.invoiceId).toBe(invoiceId);
    expect(
      (await database.document.findMany({ where: { organizationId: owner.organizationId } })).some(
        (item) => item.id === invoiceId,
      ),
    ).toBe(false);
  });
  it('links invoice uploads to their owning order automatically', async () => {
    const result = await upload({
      category: 'DEALER_INVOICE',
      title: 'Original dealer invoice',
      invoiceId,
    });
    expect(result.statusCode, result.body).toBe(201);
    expect(documentDetailSchema.parse(result.json()).orderId).toBe(orderId);
    expect(
      (
        await upload(
          { category: 'DEALER_INVOICE', title: 'No billing permission', invoiceId },
          restricted,
        )
      ).statusCode,
    ).toBe(403);
  });
  it('produces real PDF projections only for authorized records', async () => {
    for (const [source, id] of [
      ['invoice', invoiceId],
      ['order', orderId],
      ['payment', paymentId],
    ]) {
      const result = await app.inject({
        url: `/api/v1/pharmacy/documents/${source}/${id}/content`,
        headers: { cookie: owner.cookie },
      });
      expect(result.statusCode, result.body).toBe(200);
      expect(result.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
      expect(result.rawPayload.length).toBeGreaterThan(1000);
    }
  });
  it('requires internal reviewers and a valid review transition', async () => {
    expect(
      (await review(originalId, { expectedStatus: 'PENDING_REVIEW', status: 'VERIFIED' }))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await review(
          originalId,
          { expectedStatus: 'PENDING_REVIEW', status: 'UNDER_REVIEW' },
          owner,
        )
      ).statusCode,
    ).toBe(401);
    expect(
      (await review(originalId, { expectedStatus: 'PENDING_REVIEW', status: 'UNDER_REVIEW' }))
        .statusCode,
    ).toBe(200);
    expect(
      (await review(originalId, { expectedStatus: 'UNDER_REVIEW', status: 'REJECTED' })).statusCode,
    ).toBe(422);
    const result = await review(originalId, {
      expectedStatus: 'UNDER_REVIEW',
      status: 'REJECTED',
      reason: 'Upload a complete, legible licence.',
    });
    expect(result.statusCode).toBe(200);
    const doc = documentDetailSchema.parse(result.json());
    expect(doc.reviews).toHaveLength(2);
    expect(doc.status).toBe('REJECTED');
  });
  it('preserves originals, versions and rejection history during replacement', async () => {
    const result = await upload({
      replacesDocumentId: originalId,
      title: 'Renewed drug licence',
      expiresAt: '2035-01-01',
    });
    expect(result.statusCode, result.body).toBe(201);
    const replacement = documentDetailSchema.parse(result.json());
    expect(replacement.reviewStatus).toBe('PENDING_REVIEW');
    expect(replacement.versions.map((item) => item.id)).toEqual([replacement.id, originalId]);
    const prior = documentDetailSchema.parse(
      (
        await app.inject({
          url: `/api/v1/pharmacy/documents/uploads/${originalId}`,
          headers: { cookie: owner.cookie },
        })
      ).json(),
    );
    expect(prior.superseded).toBe(true);
    expect(prior.versions[0]?.id).toBe(replacement.id);
    expect(prior.reviews).toHaveLength(2);
    expect((await upload({ replacesDocumentId: originalId })).statusCode).toBe(409);
    expect(
      (await review(originalId, { expectedStatus: 'REJECTED', status: 'UNDER_REVIEW' })).statusCode,
    ).toBe(404);
  });
  it('prevents concurrent decisions from silently overwriting one another', async () => {
    const id = documentDetailSchema.parse(
      (await upload({ title: 'Review concurrency fixture' })).json(),
    ).id;
    await review(id, { expectedStatus: 'PENDING_REVIEW', status: 'UNDER_REVIEW' });
    const results = await Promise.all([
      review(id, { expectedStatus: 'UNDER_REVIEW', status: 'VERIFIED' }),
      review(id, { expectedStatus: 'UNDER_REVIEW', status: 'REJECTED', reason: 'Not legible.' }),
    ]);
    expect(results.map((item) => item.statusCode).sort()).toEqual([200, 409]);
  });
  it('queues one reminder per threshold for current uploads and verified KYC', async () => {
    const id = documentDetailSchema.parse(
      (
        await upload({
          title: 'Soon expiring fixture',
          expiresAt: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
        })
      ).json(),
    ).id;
    const run = () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/admin/documents/reminders/run',
        headers: { ...headers(admin), 'content-type': 'application/json' },
        payload: {},
      });
    expect((await run()).statusCode).toBe(200);
    expect((await run()).statusCode).toBe(200);
    expect(await database.documentReminder.count({ where: { documentId: id } })).toBe(1);
    expect(await database.documentReminder.count({ where: { kycEvidenceId: kycId } })).toBe(1);
    expect(
      await database.outboxEvent.count({
        where: { aggregateId: id, eventType: 'document.expiry_reminder' },
      }),
    ).toBe(1);
    const list = await app.inject({
      url: '/api/v1/admin/documents/?status=EXPIRING_SOON',
      headers: { cookie: admin.cookie },
    });
    expect(list.statusCode, list.body).toBe(200);
    expect(
      adminDocumentCenterSchema.parse(list.json()).documents.some((item) => item.id === id),
    ).toBe(true);
  });
  it('rejects invalid reminder policies and persists authorized changes', async () => {
    const original = await database.documentReminderPolicy.findUniqueOrThrow({
      where: { id: 'pharmacy' },
    });
    const update = (thresholds: number[]) =>
      app.inject({
        method: 'PUT',
        url: '/api/v1/admin/documents/policy',
        headers: { ...headers(admin), 'content-type': 'application/json' },
        payload: { thresholds },
      });
    expect((await update([30, 30])).statusCode).toBe(422);
    try {
      expect((await update([120, 45, 15])).statusCode).toBe(200);
      expect(
        (await database.documentReminderPolicy.findUniqueOrThrow({ where: { id: 'pharmacy' } }))
          .thresholds,
      ).toEqual([120, 45, 15]);
    } finally {
      await update(original.thresholds);
    }
  });
  it('rejects document access after session revocation', async () => {
    await database.session.update({
      where: { id: other.sessionId },
      data: { revokedAt: new Date() },
    });
    expect(
      (await app.inject({ url: '/api/v1/pharmacy/documents/', headers: { cookie: other.cookie } }))
        .statusCode,
    ).toBe(401);
  });
});
