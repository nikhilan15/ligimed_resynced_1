import { createHmac, randomInt, randomUUID } from 'node:crypto';
import { hashSessionToken, PERMISSIONS, requirePermission } from '@ligimed/auth';
import { createDatabaseClient, SessionRepository } from '@ligimed/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApi } from '../src/app.js';
import { registerPharmacyAuth } from '../src/modules/identity/pharmacy-auth-routes.js';
import {
  DevelopmentOtpProvider,
  type OtpDeliveryRequest,
} from '../src/modules/identity/otp-provider.js';
import { AuthRateLimiter } from '../src/modules/identity/auth-rate-limiter.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('A live PostgreSQL database is required.');
const database = createDatabaseClient({ databaseUrl });
const secret = 'integration-otp-secret-at-least-32-bytes';
const origin = 'http://localhost:3000';
const phones: string[] = [];
const extraOrganizations: string[] = [];
const rateKeys: string[] = [];
const messages = new Map<string, OtpDeliveryRequest>();
let failDelivery = false;
const sessions = new SessionRepository(database);
const app = await buildApi({
  logger: false,
  configuration: {
    environment: 'test',
    allowedOrigins: [origin],
    logLevel: 'info',
    trustProxy: false,
  },
  registerRoutes: (api) =>
    registerPharmacyAuth(api, {
      database,
      provider: new DevelopmentOtpProvider((message) => {
        if (failDelivery) throw new Error('private provider failure');
        messages.set(message.challengeId, message);
      }),
      environment: 'test',
      cookieName: 'ligimed_session',
      csrfSecret: 'integration-csrf-secret-at-least-32-bytes',
      otpSecret: secret,
      allowedOrigins: [origin],
      ttlSeconds: 3600,
      developmentDelivery: true,
    }),
});

function newPhone() {
  const phone = `+917${randomInt(100000000, 999999999)}`;
  phones.push(phone);
  return phone;
}
function ip() {
  const address = `192.0.2.${randomInt(1, 255)}-${randomUUID()}`;
  for (const action of ['request', 'verify'])
    rateKeys.push(
      createHmac('sha256', secret).update(`auth-ip:${action}:${address}`).digest('hex'),
    );
  return address;
}
async function browser() {
  const response = await app.inject({ url: '/api/v1/pharmacy/auth/bootstrap' });
  expect(response.statusCode).toBe(200);
  return {
    cookie: `ligimed_session_preauth=${response.cookies[0]!.value}`,
    csrf: response.json<{ csrfToken: string }>().csrfToken,
    ip: ip(),
  };
}
type Browser = Awaited<ReturnType<typeof browser>>;
function post(
  client: Browser,
  path: string,
  payload: object,
  overrides: Record<string, string> = {},
) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/pharmacy/auth/${path}`,
    remoteAddress: client.ip,
    headers: { origin, cookie: client.cookie, 'x-csrf-token': client.csrf, ...overrides },
    payload,
  });
}
async function request(
  client: Browser,
  phoneNumber: string,
  intent: 'REGISTER' | 'LOGIN' = 'REGISTER',
) {
  const response = await post(client, 'otp/request', {
    intent,
    phoneNumber,
    ...(intent === 'REGISTER'
      ? { displayName: 'PH1.1 Test Owner', pharmacyName: 'PH1.1 Test Pharmacy' }
      : {}),
  });
  expect(response.statusCode, response.body).toBe(202);
  const { challengeId } = response.json<{ challengeId: string }>();
  expect(response.body).not.toContain(messages.get(challengeId)!.code);
  return challengeId;
}
function verify(client: Browser, challengeId: string) {
  return post(client, 'otp/verify', { challengeId, code: messages.get(challengeId)!.code });
}
async function register() {
  const phone = newPhone();
  const client = await browser();
  const challengeId = await request(client, phone);
  const response = await verify(client, challengeId);
  expect(response.statusCode, response.body).toBe(200);
  const token = String(response.cookies.find((cookie) => cookie.name === 'ligimed_session')!.value);
  const resolved = await sessions.resolve(token, randomUUID());
  expect(resolved).not.toBeNull();
  return {
    phone,
    client,
    challengeId,
    response,
    token,
    context: resolved!.context,
    sessionId: resolved!.id,
  };
}
async function age(challengeId: string) {
  await database.otpChallenge.update({
    where: { id: challengeId },
    data: { createdAt: new Date(Date.now() - 61_000) },
  });
}
beforeAll(async () => {
  expect(await database.role.findUnique({ where: { key: 'PHARMACY_ADMIN' } })).not.toBeNull();
});
afterAll(async () => {
  try {
    const identities = await database.userIdentity.findMany({
      where: { type: 'PHONE', normalizedValue: { in: phones } },
      select: { userId: true },
    });
    const userIds = identities.map((item) => item.userId);
    const memberships = await database.membership.findMany({
      where: { userId: { in: userIds } },
      select: { organizationId: true },
    });
    const organizationIds = [
      ...extraOrganizations,
      ...memberships.map((item) => item.organizationId),
    ];
    await database.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await database.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await database.user.deleteMany({ where: { id: { in: userIds } } });
    await database.otpChallenge.deleteMany({ where: { identifier: { in: phones } } });
    await database.authRateLimit.deleteMany({ where: { key: { in: rateKeys } } });
  } finally {
    await app.close();
    await database.$disconnect();
  }
});

describe('PH1.1 live authentication and permissions', () => {
  it('registers a pending pharmacy atomically and issues only an onboarding session', async () => {
    const item = await register();
    const organization = await database.organization.findUniqueOrThrow({
      where: { id: item.context.organizationId },
    });
    expect(organization.status).toBe('PENDING');
    expect(item.context.permissions.size).toBe(0);
    expect(() => requirePermission(item.context, PERMISSIONS.ORGANIZATION_UPDATE)).toThrow();
    expect(item.response.body).toBe('{"status":"AUTHENTICATED"}');
    expect(String(item.response.headers['set-cookie'])).toContain('HttpOnly');
    expect(String(item.response.headers['set-cookie'])).toContain('SameSite=Lax');
    const row = await database.session.findUniqueOrThrow({ where: { id: item.sessionId } });
    expect(row.tokenHash).toBe(hashSessionToken(item.token));
    expect(row.scope).toBe('ONBOARDING');
    expect(
      await database.auditLog.count({
        where: { actorUserId: item.context.userId, action: 'pharmacy.registered' },
      }),
    ).toBe(1);
    const replay = await verify(item.client, item.challengeId);
    expect(replay.statusCode).toBe(400);
  });

  it('requires the requesting browser, CSRF token, trusted origin and JSON', async () => {
    const client = await browser();
    const other = await browser();
    const challengeId = await request(client, newPhone());
    expect((await verify(other, challengeId)).statusCode).toBe(400);
    expect(
      (
        await post(
          client,
          'otp/verify',
          { challengeId, code: messages.get(challengeId)!.code },
          { origin: 'https://evil.example' },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post(
          client,
          'otp/verify',
          { challengeId, code: messages.get(challengeId)!.code },
          { 'x-csrf-token': other.csrf },
        )
      ).statusCode,
    ).toBe(403);
    const noCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/pharmacy/auth/otp/request',
      headers: { cookie: client.cookie, origin },
      payload: {},
    });
    expect(noCsrf.statusCode).toBe(403);
    const plain = await app.inject({
      method: 'POST',
      url: '/api/v1/pharmacy/auth/otp/request',
      headers: {
        cookie: client.cookie,
        origin,
        'x-csrf-token': client.csrf,
        'content-type': 'text/plain',
      },
      payload: '{}',
    });
    expect(plain.statusCode).toBe(415);
    expect((await verify(client, challengeId)).statusCode).toBe(200);
  });

  it('rejects privileged payloads, malformed values and oversized bodies', async () => {
    const client = await browser();
    expect(
      (
        await post(client, 'otp/request', {
          intent: 'REGISTER',
          phoneNumber: newPhone(),
          displayName: 'Test',
          pharmacyName: 'Test',
          role: 'ADMIN',
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (await post(client, 'otp/verify', { challengeId: 'invalid', code: '123456' })).statusCode,
    ).toBe(422);
    expect((await post(client, 'otp/request', { data: 'x'.repeat(5000) })).statusCode).toBe(413);
  });

  it('does not reveal whether a phone exists before verifying ownership', async () => {
    const client = await browser();
    const challengeId = await request(client, newPhone(), 'LOGIN');
    const response = await verify(client, challengeId);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'PHARMACY_ACCESS_UNAVAILABLE' });
  });

  it('enforces resend cooldown, attempts, expiry and single concurrent consumption', async () => {
    const client = await browser();
    const phoneNumber = newPhone();
    const challengeId = await request(client, phoneNumber);
    expect((await post(client, 'otp/request', { intent: 'LOGIN', phoneNumber })).statusCode).toBe(
      429,
    );
    const wrongCode = messages.get(challengeId)!.code === '000000' ? '111111' : '000000';
    for (let index = 0; index < 5; index++)
      expect((await post(client, 'otp/verify', { challengeId, code: wrongCode })).statusCode).toBe(
        400,
      );
    expect((await verify(client, challengeId)).statusCode).toBe(400);
    const expired = await request(client, newPhone());
    await database.otpChallenge.update({
      where: { id: expired },
      data: { expiresAt: new Date(0) },
    });
    expect((await verify(client, expired)).statusCode).toBe(400);
    const concurrent = await request(client, newPhone());
    const results = await Promise.all([verify(client, concurrent), verify(client, concurrent)]);
    expect(results.map((item) => item.statusCode).sort()).toEqual([200, 400]);
  });

  it('invalidates earlier challenges when resending and does not create duplicate accounts', async () => {
    const item = await register();
    await age(item.challengeId);
    const duplicate = await request(item.client, item.phone);
    const response = await verify(item.client, duplicate);
    expect(response.statusCode).toBe(409);
    expect(await database.userIdentity.count({ where: { normalizedValue: item.phone } })).toBe(1);
    const client = await browser();
    const phone = newPhone();
    const first = await request(client, phone);
    await age(first);
    const second = await request(client, phone);
    expect((await verify(client, first)).statusCode).toBe(400);
    expect((await verify(client, second)).statusCode).toBe(200);
  });

  it('loads only the session pharmacy and revokes logout in PostgreSQL', async () => {
    const item = await register();
    const other = await register();
    const response = await app.inject({
      url: `/api/v1/pharmacy/auth/session?organizationId=${other.context.organizationId}`,
      headers: { cookie: `ligimed_session=${item.token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    const sessionBody = response.json<{ pharmacy: { id: string }; csrfToken: string }>();
    expect(sessionBody.pharmacy.id).toBe(item.context.organizationId);
    expect(response.body).not.toContain(other.context.organizationId);
    expect(response.body).not.toContain(item.token);
    const client = {
      ...item.client,
      cookie: `ligimed_session=${item.token}`,
      csrf: sessionBody.csrfToken,
    };
    expect(
      (await post(client, 'logout', {}, { 'x-csrf-token': item.client.csrf })).statusCode,
    ).toBe(403);
    expect((await post(client, 'logout', {})).statusCode).toBe(204);
    expect(await sessions.resolve(item.token, randomUUID())).toBeNull();
    expect(
      (
        await app.inject({
          url: '/api/v1/pharmacy/auth/session',
          headers: { cookie: client.cookie },
        })
      ).statusCode,
    ).toBe(401);
    expect((await app.inject({ url: '/api/v1/pharmacy/auth/session' })).statusCode).toBe(401);
  });

  it('signs existing pharmacies in, rotates sessions, and denies suspension', async () => {
    const item = await register();
    await age(item.challengeId);
    const client = {
      ...(await browser()),
      cookie: `${item.client.cookie}; ligimed_session=${item.token}`,
    };
    // The CSRF token belongs to the same pre-auth cookie used for the challenge.
    client.csrf = item.client.csrf;
    const challengeId = await request(client, item.phone, 'LOGIN');
    const result = await verify(client, challengeId);
    expect(result.statusCode).toBe(200);
    expect(await sessions.resolve(item.token, randomUUID())).toBeNull();
    const token = String(result.cookies.find((cookie) => cookie.name === 'ligimed_session')!.value);
    await database.organization.update({
      where: { id: item.context.organizationId },
      data: { status: 'SUSPENDED' },
    });
    expect(await sessions.resolve(token, randomUUID())).toBeNull();
    await age(challengeId);
    const denied = await request(client, item.phone, 'LOGIN');
    expect((await verify(client, denied)).statusCode).toBe(403);
  });

  it('restricts multi-pharmacy selection to owned memberships and consumes it once', async () => {
    const item = await register();
    const outsider = await register();
    const id = randomUUID();
    extraOrganizations.push(id);
    const second = await database.organization.create({
      data: {
        id,
        type: 'PHARMACY',
        status: 'ACTIVE',
        legalName: 'Second test pharmacy',
        slug: `ph11-${id}`,
        memberships: {
          create: {
            userId: item.context.userId,
            status: 'ACTIVE',
            roles: { create: { role: { connect: { key: 'PHARMACY_ADMIN' } } } },
          },
        },
      },
      include: { memberships: true },
    });
    await age(item.challengeId);
    const client = await browser();
    const challengeId = await request(client, item.phone, 'LOGIN');
    const response = await verify(client, challengeId);
    expect(response.json()).toMatchObject({ status: 'SELECT_PHARMACY' });
    const selectionBody = response.json<{ memberships: Array<{ id: string; name: string }> }>();
    expect(selectionBody.memberships).toHaveLength(2);
    expect(
      (
        await post(client, 'select-pharmacy', {
          challengeId,
          membershipId: outsider.context.membershipId,
        })
      ).statusCode,
    ).toBe(403);
    const selection = { challengeId, membershipId: second.memberships[0]!.id };
    const results = await Promise.all([
      post(client, 'select-pharmacy', selection),
      post(client, 'select-pharmacy', selection),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 400]);
    const success = results.find((result) => result.statusCode === 200)!;
    const session = await sessions.resolve(
      String(success.cookies.find((cookie) => cookie.name === 'ligimed_session')!.value),
      randomUUID(),
    );
    expect(session!.context.organizationId).toBe(id);
    expect(session!.context.permissions.has(PERMISSIONS.ORGANIZATION_READ)).toBe(true);
  });

  it('never silently upgrades onboarding tokens and rejects dealer sessions', async () => {
    const item = await register();
    await database.organization.update({
      where: { id: item.context.organizationId },
      data: { status: 'ACTIVE' },
    });
    expect((await sessions.resolve(item.token, randomUUID()))!.context.permissions.size).toBe(0);
    await database.organization.update({
      where: { id: item.context.organizationId },
      data: { type: 'DEALER' },
    });
    expect(await sessions.resolve(item.token, randomUUID())).toBeNull();
    const dealer = await sessions.create({
      userId: item.context.userId,
      membershipId: item.context.membershipId,
      organizationId: item.context.organizationId,
    });
    const response = await app.inject({
      url: '/api/v1/pharmacy/auth/session',
      headers: { cookie: `ligimed_session=${dealer.token}` },
    });
    expect(response.statusCode).toBe(403);
  });

  it('persists IP quotas and ignores forwarded-IP spoofing', async () => {
    const address = ip();
    const limiter = new AuthRateLimiter(database, secret);
    for (let index = 0; index < 30; index++) await limiter.consume(address, 'request');
    await expect(
      new AuthRateLimiter(database, secret).consume(address, 'request'),
    ).rejects.toMatchObject({ status: 429 });
    const client = { ...(await browser()), ip: address };
    expect(
      (
        await post(
          client,
          'otp/request',
          { intent: 'LOGIN', phoneNumber: newPhone() },
          { 'x-forwarded-for': '1.2.3.4' },
        )
      ).statusCode,
    ).toBe(429);
  });

  it('expires failed deliveries and returns a safe retryable error', async () => {
    const client = await browser();
    const phone = newPhone();
    failDelivery = true;
    try {
      const response = await post(client, 'otp/request', { intent: 'LOGIN', phoneNumber: phone });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ code: 'OTP_DELIVERY_UNAVAILABLE' });
      expect(response.body).not.toContain('private provider');
      expect(
        (await database.otpChallenge.findFirstOrThrow({ where: { identifier: phone } })).status,
      ).toBe('EXPIRED');
    } finally {
      failDelivery = false;
    }
  });
});
