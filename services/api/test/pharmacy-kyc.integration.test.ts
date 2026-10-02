import { createHmac, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDatabaseClient, SessionRepository } from '@ligimed/database';
import { LocalPrivateObjectStorage } from '@ligimed/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApi } from '../src/app.js';
import { registerPharmacyKyc } from '../src/modules/organizations/pharmacy-kyc-routes.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('A live PostgreSQL database is required.');
const database = createDatabaseClient({ databaseUrl });
const sessions = new SessionRepository(database);
const origin = 'http://localhost:3000';
const csrfSecret = 'integration-csrf-secret-at-least-32-bytes';
const organizationIds: string[] = [];
const userIds: string[] = [];
const storageRoot = await mkdtemp(join(tmpdir(), 'ligimed-kyc-'));
const storage = new LocalPrivateObjectStorage(storageRoot);
const app = await buildApi({
  logger: false,
  configuration: {
    environment: 'test',
    allowedOrigins: [origin],
    logLevel: 'info',
    trustProxy: false,
  },
  registerRoutes: (api) =>
    registerPharmacyKyc(api, {
      database,
      storage,
      cookieName: 'ligimed_session',
      csrfSecret,
      allowedOrigins: [origin],
    }),
});

interface Client {
  organizationId: string;
  userId: string;
  cookie: string;
  csrf: string;
}

async function client(): Promise<Client> {
  const organizationId = randomUUID();
  const userId = randomUUID();
  organizationIds.push(organizationId);
  userIds.push(userId);
  const membership = await database.membership.create({
    data: {
      user: { create: { id: userId, displayName: 'KYC Owner' } },
      organization: {
        create: {
          id: organizationId,
          type: 'PHARMACY',
          status: 'PENDING',
          legalName: 'Draft Pharmacy',
          slug: `kyc-${organizationId}`,
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
    scope: 'ONBOARDING',
  });
  return {
    organizationId,
    userId,
    cookie: `ligimed_session=${session.token}`,
    csrf: createHmac('sha256', csrfSecret)
      .update(`ligimed:csrf:v1:${session.token}`)
      .digest('base64url'),
  };
}

function profilePayload() {
  return {
    legalName: 'Verified Name Pharmacy Private Limited',
    tradeName: 'Verified Name Pharmacy',
    operationalEmail: 'owner@example.com',
    websiteUrl: 'https://example.com',
    authorizedRepresentativeName: 'KYC Owner',
    authorizedRepresentativeRole: 'Owner',
    address: {
      name: 'Primary pharmacy address',
      line1: '12 Health Street',
      line2: '',
      city: 'Bengaluru',
      district: 'Bengaluru Urban',
      state: 'Karnataka',
      stateCode: 'KA',
      postalCode: '560001',
      country: 'IN',
    },
  };
}

function jsonRequest(
  item: Client,
  method: 'PATCH' | 'POST',
  path: string,
  payload: Record<string, unknown>,
  csrf = item.csrf,
) {
  return app.inject({
    method,
    url: `/api/v1/pharmacy/onboarding/${path}`,
    headers: {
      cookie: item.cookie,
      origin,
      'x-csrf-token': csrf,
      'content-type': 'application/json',
    },
    payload,
  });
}

async function saveProfile(item: Client) {
  const response = await jsonRequest(item, 'PATCH', 'profile', profilePayload());
  expect(response.statusCode, response.body).toBe(200);
  return response;
}

async function upload(item: Client, filename = 'licence.pdf') {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/pharmacy/onboarding/evidence?category=DRUG_LICENCE&referenceNumber=DL-1&expiresAt=',
    headers: {
      cookie: item.cookie,
      origin,
      'x-csrf-token': item.csrf,
      'x-file-name': encodeURIComponent(filename),
      'content-type': 'application/pdf',
    },
    payload: Buffer.from('%PDF-1.7\nprivate test evidence'),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ kyc: { evidence: Array<{ id: string }> } }>().kyc.evidence[0]!.id;
}

beforeAll(async () => {
  expect(await database.role.findUnique({ where: { key: 'PHARMACY_ADMIN' } })).not.toBeNull();
});

afterAll(async () => {
  try {
    await database.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    const records = await database.kycRecord.findMany({
      where: { organizationId: { in: organizationIds } },
      select: { id: true },
    });
    await database.outboxEvent.deleteMany({
      where: { aggregateId: { in: records.map((record) => record.id) } },
    });
    await database.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await database.user.deleteMany({ where: { id: { in: userIds } } });
  } finally {
    await app.close();
    await database.$disconnect();
    await rm(storageRoot, { recursive: true, force: true });
  }
});

describe('PH1.2 pharmacy profile and KYC onboarding', () => {
  it('requires an authenticated pharmacy session and trusted CSRF token', async () => {
    expect((await app.inject({ url: '/api/v1/pharmacy/onboarding/state' })).statusCode).toBe(401);
    const item = await client();
    expect(
      (await jsonRequest(item, 'PATCH', 'profile', profilePayload(), 'x'.repeat(43))).statusCode,
    ).toBe(403);
    const privileged = { ...profilePayload(), status: 'VERIFIED' };
    expect((await jsonRequest(item, 'PATCH', 'profile', privileged)).statusCode).toBe(422);
  });

  it('saves one organization-scoped profile, primary address and draft revision', async () => {
    const item = await client();
    const response = await saveProfile(item);
    expect(response.json<Record<string, unknown>>()).toMatchObject({
      pharmacy: { legalName: 'Verified Name Pharmacy Private Limited' },
      kyc: { revision: 1, status: 'DRAFT', editable: true },
    });
    expect(
      await database.pharmacyProfile.count({ where: { organizationId: item.organizationId } }),
    ).toBe(1);
    expect(await database.address.count({ where: { organizationId: item.organizationId } })).toBe(
      1,
    );
    await saveProfile(item);
    expect(await database.address.count({ where: { organizationId: item.organizationId } })).toBe(
      1,
    );
  });

  it('stores private evidence, validates file signatures and blocks cross-tenant reads', async () => {
    const owner = await client();
    const outsider = await client();
    await saveProfile(owner);
    await saveProfile(outsider);
    const evidenceId = await upload(owner, 'drug-licence.pdf');
    const download = await app.inject({
      url: `/api/v1/pharmacy/onboarding/evidence/${evidenceId}/content`,
      headers: { cookie: owner.cookie },
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-disposition']).toContain('attachment');
    expect(download.body).toContain('%PDF-1.7');
    expect(
      (
        await app.inject({
          url: `/api/v1/pharmacy/onboarding/evidence/${evidenceId}/content`,
          headers: { cookie: outsider.cookie },
        })
      ).statusCode,
    ).toBe(404);
    const spoofed = await app.inject({
      method: 'POST',
      url: '/api/v1/pharmacy/onboarding/evidence?category=PAN',
      headers: {
        cookie: owner.cookie,
        origin,
        'x-csrf-token': owner.csrf,
        'x-file-name': 'fake.pdf',
        'content-type': 'application/pdf',
      },
      payload: Buffer.from('not a PDF'),
    });
    expect(spoofed.statusCode).toBe(422);
  });

  it('submits immutably with audit and outbox records', async () => {
    const item = await client();
    await saveProfile(item);
    const evidenceId = await upload(item);
    const response = await jsonRequest(item, 'POST', 'submit', { declarationAccepted: true });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<Record<string, unknown>>()).toMatchObject({
      kyc: { status: 'SUBMITTED', editable: false },
    });
    expect((await jsonRequest(item, 'PATCH', 'profile', profilePayload())).statusCode).toBe(409);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/v1/pharmacy/onboarding/evidence/${evidenceId}`,
          headers: { cookie: item.cookie, origin, 'x-csrf-token': item.csrf },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      await database.auditLog.count({
        where: { organizationId: item.organizationId, action: 'pharmacy.kyc_submitted' },
      }),
    ).toBe(1);
    expect(
      await database.outboxEvent.count({
        where: { aggregateType: 'kyc_record', eventType: 'pharmacy.kyc.submitted' },
      }),
    ).toBeGreaterThan(0);
  });

  it('requires a saved profile, evidence and an explicit declaration', async () => {
    const item = await client();
    expect(
      (await jsonRequest(item, 'POST', 'submit', { declarationAccepted: true })).statusCode,
    ).toBe(409);
    await saveProfile(item);
    expect(
      (await jsonRequest(item, 'POST', 'submit', { declarationAccepted: true })).statusCode,
    ).toBe(409);
    await upload(item);
    expect(
      (await jsonRequest(item, 'POST', 'submit', { declarationAccepted: false })).statusCode,
    ).toBe(422);
  });

  it('creates a new revision after rejection instead of overwriting history', async () => {
    const item = await client();
    await saveProfile(item);
    await database.kycRecord.updateMany({
      where: { organizationId: item.organizationId },
      data: { status: 'REJECTED', rejectionReason: 'Test review note' },
    });
    const response = await saveProfile(item);
    expect(response.json<Record<string, unknown>>()).toMatchObject({
      kyc: { revision: 2, status: 'DRAFT' },
    });
    expect(await database.kycRecord.count({ where: { organizationId: item.organizationId } })).toBe(
      2,
    );
  });
});
