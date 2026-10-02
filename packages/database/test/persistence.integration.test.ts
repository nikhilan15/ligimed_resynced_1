import { randomUUID } from 'node:crypto';

import { AuthorizationError, createSessionToken, hashSessionToken } from '@ligimed/auth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseClient } from '../src/index.js';
import { OtpRateLimitError, OtpRepository } from '../src/otp-repository.js';
import { SessionRepository } from '../src/session-repository.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required for live PostgreSQL integration tests');
const database = createDatabaseClient({ databaseUrl });
const secret = 'integration-only-otp-hash-secret-at-least-32-bytes';
const otp = new OtpRepository(database, secret);
const sessions = new SessionRepository(database);
const ownedUsers: string[] = [];
const ownedOrganizations: string[] = [];
const ownedRoles: string[] = [];
const ownedPermissions: string[] = [];
const ownedIdentifiers: string[] = [];

function subject() {
  const identifier = `${randomUUID()}@integration.ligimed.test`;
  ownedIdentifiers.push(identifier);
  return { identifier, purpose: 'SIGN_IN' as const };
}

function wrongCode(code: string): string {
  return code === '000000' ? '111111' : '000000';
}

async function sessionFixture() {
  const userId = randomUUID();
  const organizationId = randomUUID();
  const membershipId = randomUUID();
  ownedUsers.push(userId);
  ownedOrganizations.push(organizationId);
  await database.user.create({ data: { id: userId } });
  await database.organization.create({
    data: {
      id: organizationId,
      type: 'PHARMACY',
      status: 'ACTIVE',
      legalName: 'Persistence test',
      slug: `persistence-${organizationId}`,
    },
  });
  await database.membership.create({
    data: { id: membershipId, userId, organizationId, status: 'ACTIVE' },
  });
  return { userId, organizationId, membershipId };
}

beforeAll(async () => {
  await database.$connect();
});
afterAll(async () => {
  try {
    // Delete only UUIDs/identifiers allocated by this test run; never reset the database.
    await database.otpChallenge.deleteMany({ where: { identifier: { in: ownedIdentifiers } } });
    await database.user.deleteMany({ where: { id: { in: ownedUsers } } });
    await database.organization.deleteMany({ where: { id: { in: ownedOrganizations } } });
    await database.role.deleteMany({ where: { id: { in: ownedRoles } } });
    await database.permission.deleteMany({ where: { id: { in: ownedPermissions } } });
  } finally {
    await database.$disconnect();
  }
});

describe('persistent OTP security', () => {
  it('stores a challenge-bound HMAC and consumes a valid code once across repository instances', async () => {
    const input = subject();
    const issued = await otp.issue(input);
    const stored = await database.otpChallenge.findUniqueOrThrow({ where: { id: issued.id } });
    expect(stored.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.codeHash).not.toBe(issued.code);
    const otherInstance = new OtpRepository(database, secret);
    expect(
      await otherInstance.verify({ ...input, challengeId: issued.id, code: issued.code }),
    ).toBe('VERIFIED');
    expect(await otp.verify({ ...input, challengeId: issued.id, code: issued.code })).toBe(
      'INVALID',
    );
    const consumed = await database.otpChallenge.findUniqueOrThrow({ where: { id: issued.id } });
    expect(consumed.status).toBe('VERIFIED');
    expect(consumed.consumedAt).toBeInstanceOf(Date);
  });

  it('rejects expired codes and persists the expired status', async () => {
    const input = subject();
    const issued = await otp.issue(input);
    await database.otpChallenge.update({
      where: { id: issued.id },
      data: { expiresAt: new Date(0) },
    });
    expect(await otp.verify({ ...input, challengeId: issued.id, code: issued.code })).toBe(
      'EXPIRED',
    );
    expect(
      (await database.otpChallenge.findUniqueOrThrow({ where: { id: issued.id } })).status,
    ).toBe('EXPIRED');
  });

  it('enforces the attempt limit even when attempts race, including a later correct code', async () => {
    const input = subject();
    const issued = await otp.issue(input);
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () =>
        otp.verify({
          ...input,
          challengeId: issued.id,
          code: wrongCode(issued.code),
        }),
      ),
    );
    expect(outcomes.filter((outcome) => outcome === 'INVALID')).toHaveLength(4);
    expect(outcomes.filter((outcome) => outcome === 'LOCKED')).toHaveLength(4);
    expect(
      (await database.otpChallenge.findUniqueOrThrow({ where: { id: issued.id } })).attempts,
    ).toBe(5);
    expect(await otp.verify({ ...input, challengeId: issued.id, code: issued.code })).toBe(
      'LOCKED',
    );
  });

  it('allows exactly one successful consume under concurrent verification', async () => {
    const input = subject();
    const issued = await otp.issue(input);
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () =>
        otp.verify({
          ...input,
          challengeId: issued.id,
          code: issued.code,
        }),
      ),
    );
    expect(outcomes.filter((outcome) => outcome === 'VERIFIED')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'INVALID')).toHaveLength(4);
  });

  it('binds verification to the expected identifier, purpose, and server secret', async () => {
    const input = subject();
    const issued = await otp.issue(input);
    expect(await otp.verify({ ...subject(), challengeId: issued.id, code: issued.code })).toBe(
      'INVALID',
    );
    expect(
      await otp.verify({
        ...input,
        purpose: 'STEP_UP_AUTH',
        challengeId: issued.id,
        code: issued.code,
      }),
    ).toBe('INVALID');
    const wrongSecretRepository = new OtpRepository(database, `${secret}-wrong`);
    expect(
      await wrongSecretRepository.verify({ ...input, challengeId: issued.id, code: issued.code }),
    ).toBe('INVALID');
  });

  it('persists resend throttling and serializes concurrent issuance', async () => {
    const input = subject();
    const anotherRepository = new OtpRepository(database, secret);
    const outcomes = await Promise.allSettled([otp.issue(input), anotherRepository.issue(input)]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason instanceof OtpRateLimitError).toBe(
      true,
    );
    await expect(anotherRepository.issue(input)).rejects.toBeInstanceOf(OtpRateLimitError);
  });

  it('canonicalizes email aliases before throttling and verification', async () => {
    const input = subject();
    const issued = await otp.issue(input);
    const alias = { ...input, identifier: ` ${input.identifier.toUpperCase()} ` };
    await expect(otp.issue(alias)).rejects.toBeInstanceOf(OtpRateLimitError);
    expect(await otp.verify({ ...alias, challengeId: issued.id, code: issued.code })).toBe(
      'VERIFIED',
    );
    await expect(otp.issue({ ...input, identifier: 'invalid subject' })).rejects.toThrow();
  });

  it('invalidates an earlier challenge when a resend is allowed', async () => {
    const input = subject();
    const first = await otp.issue(input);
    await database.otpChallenge.update({
      where: { id: first.id },
      data: { createdAt: new Date(Date.now() - 120_000) },
    });
    const second = await otp.issue(input);
    expect(await otp.verify({ ...input, challengeId: first.id, code: first.code })).toBe('EXPIRED');
    expect(await otp.verify({ ...input, challengeId: second.id, code: second.code })).toBe(
      'VERIFIED',
    );
  });

  it('persists aggregate verification and issuance limits across challenges', async () => {
    const input = subject();
    for (let index = 0; index < 4; index += 1) {
      const issued = await otp.issue(input);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await otp.verify({ ...input, challengeId: issued.id, code: wrongCode(issued.code) });
      }
      await database.otpChallenge.update({
        where: { id: issued.id },
        data: { createdAt: new Date(Date.now() - 120_000) },
      });
    }
    const last = await otp.issue(input);
    const anotherRepository = new OtpRepository(database, secret);
    expect(
      await anotherRepository.verify({ ...input, challengeId: last.id, code: last.code }),
    ).toBe('RATE_LIMITED');
    await database.otpChallenge.update({
      where: { id: last.id },
      data: { createdAt: new Date(Date.now() - 120_000) },
    });
    await expect(anotherRepository.issue(input)).rejects.toBeInstanceOf(OtpRateLimitError);
  });
});

describe('persistent session security', () => {
  it('stores only the token hash and resolves from a second repository instance', async () => {
    const fixture = await sessionFixture();
    const issued = await sessions.create(fixture);
    const stored = await database.session.findUniqueOrThrow({ where: { id: issued.id } });
    expect(stored.tokenHash).toBe(hashSessionToken(issued.token));
    expect(stored.tokenHash).not.toBe(issued.token);
    const resolved = await new SessionRepository(database).resolve(
      issued.token,
      'persistence-request',
    );
    expect(resolved?.context).toMatchObject({ ...fixture, requestId: 'persistence-request' });
    expect(await sessions.resolve('not-a-token', 'request')).toBeNull();
    expect(await sessions.resolve(`${issued.token.slice(0, -1)}!`, 'request')).toBeNull();
  });

  it('rejects mismatched user, membership, and organization at creation', async () => {
    const first = await sessionFixture();
    const second = await sessionFixture();
    await expect(sessions.create({ ...first, userId: second.userId })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(
      sessions.create({ ...first, organizationId: second.organizationId }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      sessions.create({ ...first, membershipId: second.membershipId }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('fails closed if an inconsistent session ownership row exists', async () => {
    const first = await sessionFixture();
    const second = await sessionFixture();
    const token = createSessionToken();
    await database.session.create({
      data: {
        userId: first.userId,
        membershipId: second.membershipId,
        activeOrganizationId: first.organizationId,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    expect(await sessions.resolve(token, 'request')).toBeNull();
  });

  it('validates bounded session lifetimes', async () => {
    const fixture = await sessionFixture();
    for (const ttlSeconds of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_592_001]) {
      await expect(sessions.create({ ...fixture, ttlSeconds })).rejects.toThrow('Session lifetime');
    }
  });

  it('rejects expired and revoked sessions', async () => {
    const fixture = await sessionFixture();
    const expired = await sessions.create(fixture);
    await database.session.update({ where: { id: expired.id }, data: { expiresAt: new Date(0) } });
    expect(await sessions.resolve(expired.token, 'request')).toBeNull();
    const revoked = await sessions.create(fixture);
    expect(await sessions.revokeToken(revoked.token)).toBe(true);
    expect(await sessions.resolve(revoked.token, 'request')).toBeNull();
    expect(await sessions.revokeToken(revoked.token)).toBe(false);
  });

  it('restricts session revocation to the authenticated user and organization', async () => {
    const first = await sessionFixture();
    const second = await sessionFixture();
    const firstSession = await sessions.create(first);
    const secondSession = await sessions.create(second);
    const firstContext = (await sessions.resolve(firstSession.token, 'request'))?.context;
    if (!firstContext) throw new Error('Expected a valid fixture session');
    expect(await sessions.revoke(secondSession.id, firstContext)).toBe(false);
    expect(await sessions.resolve(secondSession.token, 'request')).not.toBeNull();
    expect(await sessions.revoke(firstSession.id, firstContext)).toBe(true);
    expect(await sessions.resolve(firstSession.token, 'request')).toBeNull();
  });

  it('rejects inactive users immediately for both existing and new sessions', async () => {
    const fixture = await sessionFixture();
    const issued = await sessions.create(fixture);
    await database.user.update({ where: { id: fixture.userId }, data: { isActive: false } });
    expect(await sessions.resolve(issued.token, 'request')).toBeNull();
    await expect(sessions.create(fixture)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it.each(['INVITED', 'SUSPENDED', 'REVOKED'] as const)(
    'rejects %s memberships on issue and resolve',
    async (status) => {
      const fixture = await sessionFixture();
      const issued = await sessions.create(fixture);
      await database.membership.update({ where: { id: fixture.membershipId }, data: { status } });
      expect(await sessions.resolve(issued.token, 'request')).toBeNull();
      await expect(sessions.create(fixture)).rejects.toBeInstanceOf(AuthorizationError);
    },
  );

  it.each(['PENDING', 'SUSPENDED', 'CLOSED'] as const)(
    'rejects %s organizations on issue and resolve',
    async (status) => {
      const fixture = await sessionFixture();
      const issued = await sessions.create(fixture);
      await database.organization.update({
        where: { id: fixture.organizationId },
        data: { status },
      });
      expect(await sessions.resolve(issued.token, 'request')).toBeNull();
      await expect(sessions.create(fixture)).rejects.toBeInstanceOf(AuthorizationError);
    },
  );

  it('reloads role permissions on every resolve without an administrator bypass', async () => {
    const fixture = await sessionFixture();
    const roleId = randomUUID();
    const permissionId = randomUUID();
    ownedRoles.push(roleId);
    ownedPermissions.push(permissionId);
    await database.permission.create({
      data: {
        id: permissionId,
        key: `integration.${permissionId}`,
        description: 'Test permission',
      },
    });
    await database.role.create({
      data: {
        id: roleId,
        key: `integration.${roleId}`,
        name: 'Test administrator',
        organizationType: 'PHARMACY',
      },
    });
    await database.rolePermission.create({ data: { roleId, permissionId } });
    await database.membershipRole.create({ data: { membershipId: fixture.membershipId, roleId } });
    const issued = await sessions.create(fixture);
    expect(
      (await sessions.resolve(issued.token, 'request'))?.context.permissions.has(
        `integration.${permissionId}`,
      ),
    ).toBe(true);
    await database.rolePermission.delete({
      where: { roleId_permissionId: { roleId, permissionId } },
    });
    expect((await sessions.resolve(issued.token, 'request'))?.context.permissions.size).toBe(0);
    await database.rolePermission.create({ data: { roleId, permissionId } });
    await database.role.update({
      where: { id: roleId },
      data: { organizationType: 'LIGIMED_INTERNAL' },
    });
    expect((await sessions.resolve(issued.token, 'request'))?.context.permissions.size).toBe(0);
  });
});
