import { createHmac, randomInt, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDatabaseClient, SessionRepository } from '@ligimed/database';
import { LocalPrivateObjectStorage } from '@ligimed/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApi } from '../src/app.js';
import { registerDealerAuth } from '../src/modules/identity/pharmacy-auth-routes.js';
import {
  DevelopmentOtpProvider,
  type OtpDeliveryRequest,
} from '../src/modules/identity/otp-provider.js';
import { registerPharmacyMarketplace } from '../src/modules/marketplace/pharmacy-marketplace-routes.js';
import { registerAdminKycReview } from '../src/modules/organizations/admin-kyc-review-routes.js';
import { registerDealerKyc } from '../src/modules/organizations/pharmacy-kyc-routes.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('A live PostgreSQL database is required.');
const database = createDatabaseClient({ databaseUrl });
const sessions = new SessionRepository(database);
const csrfSecret = 'dealer-integration-csrf-secret-at-least-32-bytes';
const otpSecret = 'dealer-integration-otp-secret-at-least-32-bytes';
const dealerOrigin = 'http://localhost:3001';
const adminOrigin = 'http://localhost:3003';
const pharmacyOrigin = 'http://localhost:3000';
const phone = `+918${randomInt(100000000, 999999999)}`;
const organizationIds: string[] = [];
const userIds: string[] = [];
const messages = new Map<string, OtpDeliveryRequest>();
const storageRoot = await mkdtemp(join(tmpdir(), 'ligimed-dealer-kyc-'));
const storage = new LocalPrivateObjectStorage(storageRoot);
const app = await buildApi({
  logger: false,
  configuration: {
    environment: 'test',
    allowedOrigins: [dealerOrigin, adminOrigin, pharmacyOrigin],
    logLevel: 'info',
    trustProxy: false,
  },
  registerRoutes: async (api) => {
    await registerDealerAuth(api, {
      database,
      provider: new DevelopmentOtpProvider((message) => {
        messages.set(message.challengeId, message);
      }),
      environment: 'test',
      cookieName: 'ligimed_session_dealer',
      csrfSecret,
      otpSecret,
      allowedOrigins: [dealerOrigin, adminOrigin, pharmacyOrigin],
      ttlSeconds: 3600,
      developmentDelivery: true,
    });
    await registerDealerKyc(api, {
      database,
      storage,
      cookieName: 'ligimed_session_dealer',
      csrfSecret,
      allowedOrigins: [dealerOrigin, adminOrigin, pharmacyOrigin],
    });
    await registerAdminKycReview(api, {
      database,
      storage,
      cookieName: 'ligimed_session_admin',
      csrfSecret,
      allowedOrigins: [dealerOrigin, adminOrigin, pharmacyOrigin],
    });
    await registerPharmacyMarketplace(api, {
      database,
      cookieName: 'ligimed_session',
      csrfSecret,
      allowedOrigins: [dealerOrigin, adminOrigin, pharmacyOrigin],
    });
  },
});

function csrf(token: string) {
  return createHmac('sha256', csrfSecret).update(`ligimed:csrf:v1:${token}`).digest('base64url');
}

async function member(type: 'PHARMACY' | 'LIGIMED_INTERNAL', role: string) {
  const organizationId = randomUUID();
  const userId = randomUUID();
  organizationIds.push(organizationId);
  userIds.push(userId);
  const membership = await database.membership.create({
    data: {
      user: { create: { id: userId, displayName: 'Test reviewer' } },
      organization: {
        create: {
          id: organizationId,
          type,
          status: 'ACTIVE',
          legalName: `Test ${type}`,
          slug: `dealer-test-${organizationId}`,
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
    organizationId,
    scope: 'FULL',
  });
  return {
    cookie: `${type === 'PHARMACY' ? 'ligimed_session' : 'ligimed_session_admin'}=${session.token}`,
    csrf: csrf(session.token),
  };
}

beforeAll(async () => {
  expect(await database.role.findUnique({ where: { key: 'DEALER_ADMIN' } })).not.toBeNull();
  expect(await database.role.findUnique({ where: { key: 'LIGIMED_COMPLIANCE' } })).not.toBeNull();
});

afterAll(async () => {
  try {
    const identity = await database.userIdentity.findUnique({
      where: { type_normalizedValue: { type: 'PHONE', normalizedValue: phone } },
    });
    if (identity) {
      const memberships = await database.membership.findMany({
        where: { userId: identity.userId },
        select: { organizationId: true },
      });
      organizationIds.push(...memberships.map((item) => item.organizationId));
      userIds.push(identity.userId);
    }
    const records = await database.kycRecord.findMany({
      where: { organizationId: { in: organizationIds } },
      select: { id: true },
    });
    await database.outboxEvent.deleteMany({
      where: { aggregateId: { in: records.map((item) => item.id) } },
    });
    await database.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await database.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await database.user.deleteMany({ where: { id: { in: userIds } } });
    await database.otpChallenge.deleteMany({ where: { identifier: phone } });
  } finally {
    await app.close();
    await database.$disconnect();
    await rm(storageRoot, { recursive: true, force: true });
  }
});

describe('dealer onboarding and marketplace activation', () => {
  it('keeps a dealer private until evidence is reviewed and approval is audited', async () => {
    const browser = await app.inject({
      url: '/api/v1/dealer/auth/bootstrap',
      headers: { origin: dealerOrigin },
    });
    expect(browser.statusCode).toBe(200);
    const preAuthCookie = `ligimed_session_dealer_preauth=${browser.cookies[0]!.value}`;
    const preAuthCsrf = browser.json<{ csrfToken: string }>().csrfToken;
    const request = await app.inject({
      method: 'POST',
      url: '/api/v1/dealer/auth/otp/request',
      headers: { origin: dealerOrigin, cookie: preAuthCookie, 'x-csrf-token': preAuthCsrf },
      payload: {
        intent: 'REGISTER',
        phoneNumber: phone,
        displayName: 'Dealer Owner',
        dealerName: 'Test Medicine Dealer',
      },
    });
    expect(request.statusCode, request.body).toBe(202);
    const challengeId = request.json<{ challengeId: string }>().challengeId;
    const verify = await app.inject({
      method: 'POST',
      url: '/api/v1/dealer/auth/otp/verify',
      headers: { origin: dealerOrigin, cookie: preAuthCookie, 'x-csrf-token': preAuthCsrf },
      payload: { challengeId, code: messages.get(challengeId)!.code },
    });
    expect(verify.statusCode, verify.body).toBe(200);
    const dealerToken = verify.cookies.find(
      (item) => item.name === 'ligimed_session_dealer',
    )!.value;
    const dealerCookie = `ligimed_session_dealer=${dealerToken}`;
    const dealerCsrf = csrf(dealerToken);
    const dealerSession = await sessions.resolve(dealerToken, randomUUID());
    expect(dealerSession).not.toBeNull();
    const dealerId = dealerSession!.context.organizationId;
    expect(
      await database.organization.findUnique({
        where: { id: dealerId },
        select: { type: true, status: true },
      }),
    ).toMatchObject({ type: 'DEALER', status: 'PENDING' });

    const pharmacy = await member('PHARMACY', 'PHARMACY_ADMIN');
    const before = await app.inject({
      url: '/api/v1/pharmacy/marketplace/dealers',
      headers: { cookie: pharmacy.cookie },
    });
    expect(
      before
        .json<{ dealers: Array<{ id: string }> }>()
        .dealers.some((item) => item.id === dealerId),
    ).toBe(false);

    const profile = await app.inject({
      method: 'PATCH',
      url: '/api/v1/dealer/onboarding/profile',
      headers: {
        cookie: dealerCookie,
        origin: dealerOrigin,
        'x-csrf-token': dealerCsrf,
        'content-type': 'application/json',
      },
      payload: {
        legalName: 'Test Medicine Dealer Private Limited',
        tradeName: 'Test Medicine Dealer',
        operationalEmail: 'dealer@example.com',
        websiteUrl: '',
        authorizedRepresentativeName: 'Dealer Owner',
        authorizedRepresentativeRole: 'Owner',
        summary: 'Local distribution partner',
        serviceAreas: ['Bengaluru'],
        address: {
          name: 'Primary',
          line1: '1 Market Road',
          line2: '',
          city: 'Bengaluru',
          district: 'Bengaluru Urban',
          state: 'Karnataka',
          stateCode: 'KA',
          postalCode: '560001',
          country: 'IN',
        },
      },
    });
    expect(profile.statusCode, profile.body).toBe(200);
    const wrongTenant = await app.inject({
      url: '/api/v1/dealer/onboarding/state',
      headers: { cookie: pharmacy.cookie },
    });
    expect(wrongTenant.statusCode).toBe(401);

    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/dealer/onboarding/evidence?category=BUSINESS_REGISTRATION&referenceNumber=BR-1&expiresAt=',
      headers: {
        cookie: dealerCookie,
        origin: dealerOrigin,
        'x-csrf-token': dealerCsrf,
        'x-file-name': 'business.pdf',
        'content-type': 'application/pdf',
      },
      payload: Buffer.from('%PDF-1.7\nprivate dealer evidence'),
    });
    expect(upload.statusCode, upload.body).toBe(200);
    const submitted = await app.inject({
      method: 'POST',
      url: '/api/v1/dealer/onboarding/submit',
      headers: {
        cookie: dealerCookie,
        origin: dealerOrigin,
        'x-csrf-token': dealerCsrf,
        'content-type': 'application/json',
      },
      payload: { declarationAccepted: true },
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const kycId = submitted.json<{ kyc: { id: string } }>().kyc.id;
    expect(
      (
        await app.inject({
          url: '/api/v1/pharmacy/marketplace/dealers',
          headers: { cookie: pharmacy.cookie },
        })
      )
        .json<{ dealers: Array<{ id: string }> }>()
        .dealers.some((item) => item.id === dealerId),
    ).toBe(false);

    const reviewer = await member('LIGIMED_INTERNAL', 'LIGIMED_COMPLIANCE');
    const detail = await app.inject({
      url: `/api/v1/admin/reviews/kyc/${kycId}`,
      headers: { cookie: reviewer.cookie },
    });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json()).toMatchObject({
      organization: { id: dealerId, type: 'DEALER' },
      profile: { summary: 'Local distribution partner' },
    });
    const approve = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/reviews/kyc/${kycId}/decision`,
      headers: {
        cookie: reviewer.cookie,
        origin: adminOrigin,
        'x-csrf-token': reviewer.csrf,
        'content-type': 'application/json',
      },
      payload: { decision: 'APPROVE' },
    });
    expect(approve.statusCode, approve.body).toBe(200);
    expect(
      (await database.organization.findUniqueOrThrow({ where: { id: dealerId } })).status,
    ).toBe('ACTIVE');
    expect(
      await database.auditLog.count({
        where: { organizationId: dealerId, action: 'admin.kyc_approved' },
      }),
    ).toBe(1);
    expect(
      await database.outboxEvent.count({
        where: { aggregateId: kycId, eventType: 'dealer.kyc.verified' },
      }),
    ).toBe(1);
    expect(
      (
        await app.inject({
          url: '/api/v1/pharmacy/marketplace/dealers',
          headers: { cookie: pharmacy.cookie },
        })
      )
        .json<{ dealers: Array<{ id: string }> }>()
        .dealers.some((item) => item.id === dealerId),
    ).toBe(true);
    const stale = await app.inject({
      url: '/api/v1/dealer/auth/session',
      headers: { cookie: dealerCookie },
    });
    expect(stale.statusCode).toBe(401);
  });
});
