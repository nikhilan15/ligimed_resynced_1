import { randomUUID } from 'node:crypto';

import { AuthorizationError, hashSessionToken } from '@ligimed/auth';
import type { OtpRepository, Prisma, PrismaClient, SessionRepository } from '@ligimed/database';
import type { RequestContext } from '@ligimed/types';
import { dealerOtpRequestSchema, pharmacyOtpRequestSchema } from '@ligimed/validation';

import { AppError } from '../../platform/errors.js';
import type { OtpProvider } from './otp-provider.js';

const invalidCode = () =>
  new AppError(400, 'OTP_INVALID', 'The code is invalid, expired or already used.');
const unavailableAccount = (kind: 'PHARMACY' | 'DEALER') =>
  new AppError(
    403,
    `${kind}_ACCESS_UNAVAILABLE`,
    `This phone cannot access a ${kind.toLowerCase()} account. Check your registration or contact your account administrator.`,
  );

/** One OTP/session workflow for both trading partner roles. */
export class PartnerAuthService {
  constructor(
    private readonly database: PrismaClient,
    private readonly otp: OtpRepository,
    private readonly sessions: SessionRepository,
    private readonly provider: OtpProvider,
    private readonly ttlSeconds: number,
    private readonly kind: 'PHARMACY' | 'DEALER' = 'PHARMACY',
  ) {}

  async requestCode(body: unknown, browserToken: string) {
    const input = (
      this.kind === 'PHARMACY' ? pharmacyOtpRequestSchema : dealerOtpRequestSchema
    ).parse(body);
    const challenge = await this.otp.issue({ identifier: input.phoneNumber, purpose: 'SIGN_IN' });
    try {
      await this.database.partnerAuthAttempt.create({
        data: {
          challengeId: challenge.id,
          browserTokenHash: hashSessionToken(browserToken),
          intent: input.intent,
          organizationType: this.kind,
          ...(input.intent === 'REGISTER'
            ? {
                displayName: input.displayName,
                organizationName: 'pharmacyName' in input ? input.pharmacyName : input.dealerName,
              }
            : {}),
        },
      });
      await this.provider.send({
        challengeId: challenge.id,
        phoneNumber: input.phoneNumber,
        code: challenge.code,
        expiresInSeconds: 300,
      });
    } catch {
      await this.database.otpChallenge.update({
        where: { id: challenge.id },
        data: { status: 'EXPIRED' },
      });
      throw new AppError(
        503,
        'OTP_DELIVERY_UNAVAILABLE',
        'We could not send a code. Please try again later.',
      );
    }
    return {
      challengeId: challenge.id,
      expiresAt: challenge.expiresAt.toISOString(),
      retryAfterSeconds: 60,
    };
  }

  async verifyCode(
    input: { challengeId: string; code: string },
    browserToken: string,
    requestId: string,
    previousToken?: string,
  ) {
    const attempt = await this.database.partnerAuthAttempt.findFirst({
      where: {
        challengeId: input.challengeId,
        browserTokenHash: hashSessionToken(browserToken),
        organizationType: this.kind,
        completedAt: null,
      },
      include: { challenge: true },
    });
    if (!attempt) throw invalidCode();
    const result = await this.otp.verify({
      ...input,
      identifier: attempt.challenge.identifier,
      purpose: 'SIGN_IN',
    });
    if (result !== 'VERIFIED') throw invalidCode();
    await this.database.partnerAuthAttempt.update({
      where: { challengeId: input.challengeId },
      data: { verifiedAt: new Date() },
    });
    if (attempt.intent === 'REGISTER') {
      const session = await this.complete(
        input.challengeId,
        browserToken,
        requestId,
        undefined,
        previousToken,
      );
      return { status: 'AUTHENTICATED' as const, session };
    }
    const memberships = await this.eligibleMemberships(this.database, attempt.challenge.identifier);
    if (memberships.length === 0) throw unavailableAccount(this.kind);
    if (memberships.length === 1) {
      const session = await this.complete(
        input.challengeId,
        browserToken,
        requestId,
        memberships[0]!.id,
        previousToken,
      );
      return { status: 'AUTHENTICATED' as const, session };
    }
    const choices = memberships.map((item) => ({ id: item.id, name: item.organization.legalName }));
    return this.kind === 'PHARMACY'
      ? { status: 'SELECT_PHARMACY' as const, memberships: choices }
      : { status: 'SELECT_DEALER' as const, memberships: choices };
  }

  async complete(
    challengeId: string,
    browserToken: string,
    requestId: string,
    membershipId?: string,
    previousToken?: string,
  ) {
    return this.database.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "challengeId" FROM partner_auth_attempts WHERE "challengeId" = ${challengeId}::uuid FOR UPDATE`;
      const attempt = await tx.partnerAuthAttempt.findFirst({
        where: {
          challengeId,
          browserTokenHash: hashSessionToken(browserToken),
          organizationType: this.kind,
          completedAt: null,
          verifiedAt: { not: null },
        },
        include: { challenge: true },
      });
      if (
        !attempt ||
        attempt.challenge.status !== 'VERIFIED' ||
        attempt.challenge.expiresAt.getTime() <= Date.now()
      )
        throw invalidCode();
      let selected;
      if (attempt.intent === 'REGISTER') {
        const phone = attempt.challenge.identifier;
        // Serialize registration for the same phone, including simultaneous browser attempts.
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`register:${phone}`}, 0))`;
        const identity = await tx.userIdentity.findUnique({
          where: { type_normalizedValue: { type: 'PHONE', normalizedValue: phone } },
        });
        if (identity && this.kind === 'PHARMACY') {
          throw new AppError(
            409,
            'PHONE_ALREADY_REGISTERED',
            'This mobile number is already registered. Please sign in.',
          );
        }
        const role = await tx.role.findUnique({
          where: { key: `${this.kind}_ADMIN`, organizationType: this.kind },
        });
        if (!role || !attempt.displayName || !attempt.organizationName)
          throw new Error('Registration configuration unavailable');
        if (
          identity &&
          (await tx.membership.count({
            where: { userId: identity.userId, organization: { type: this.kind }, status: 'ACTIVE' },
          })) > 0
        ) {
          throw new AppError(
            409,
            'ACCOUNT_ALREADY_REGISTERED',
            'This mobile number already has an account. Please sign in.',
          );
        }
        const organization = await tx.organization.create({
          data: {
            type: this.kind,
            status: 'PENDING',
            legalName: attempt.organizationName,
            slug: `${this.kind.toLowerCase()}-${randomUUID()}`,
          },
        });
        const user = identity
          ? await tx.user.findUniqueOrThrow({ where: { id: identity.userId } })
          : await tx.user.create({
              data: {
                displayName: attempt.displayName,
                identities: {
                  create: { type: 'PHONE', normalizedValue: phone, verifiedAt: new Date() },
                },
              },
            });
        if (!user.isActive) throw unavailableAccount(this.kind);
        selected = await tx.membership.create({
          data: {
            organizationId: organization.id,
            userId: user.id,
            status: 'ACTIVE',
            joinedAt: new Date(),
            roles: { create: { roleId: role.id } },
          },
          include: { organization: true },
        });
      } else {
        const memberships = await this.eligibleMemberships(tx, attempt.challenge.identifier);
        selected = memberships.find((item) => item.id === membershipId);
        if (!selected) throw unavailableAccount(this.kind);
      }
      const session = await this.sessions.createInTransaction(tx, {
        userId: selected.userId,
        membershipId: selected.id,
        organizationId: selected.organizationId,
        scope: selected.organization.status === 'PENDING' ? 'ONBOARDING' : 'FULL',
        ttlSeconds: this.ttlSeconds,
      });
      if (previousToken)
        await tx.session.updateMany({
          where: { tokenHash: hashSessionToken(previousToken), revokedAt: null },
          data: { revokedAt: new Date() },
        });
      await tx.partnerAuthAttempt.update({
        where: { challengeId },
        data: { completedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          requestId,
          actorUserId: selected.userId,
          organizationId: selected.organizationId,
          action:
            attempt.intent === 'REGISTER'
              ? `${this.kind.toLowerCase()}.registered`
              : `${this.kind.toLowerCase()}.signed_in`,
          resourceType: 'session',
          resourceId: session.id,
          outcome: 'SUCCESS',
        },
      });
      return session;
    });
  }

  async account(sessionId: string, context: RequestContext) {
    const session = await this.database.session.findFirst({
      where: {
        id: sessionId,
        userId: context.userId,
        membershipId: context.membershipId,
        activeOrganizationId: context.organizationId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { isActive: true },
        membership: {
          status: 'ACTIVE',
          roles: { some: { role: { organizationType: this.kind } } },
        },
        activeOrganization: { type: this.kind, status: { in: ['PENDING', 'ACTIVE'] } },
      },
      select: {
        scope: true,
        expiresAt: true,
        user: { select: { id: true, displayName: true } },
        activeOrganization: { select: { id: true, legalName: true, status: true } },
      },
    });
    if (!session) throw new AuthorizationError();
    return {
      user: session.user,
      [this.kind === 'PHARMACY' ? 'pharmacy' : 'dealer']: {
        id: session.activeOrganization.id,
        name: session.activeOrganization.legalName,
        status: session.activeOrganization.status,
      },
      access: session.scope,
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  async logout(sessionId: string, context: RequestContext) {
    await this.database.$transaction(async (tx) => {
      await tx.session.updateMany({
        where: {
          id: sessionId,
          userId: context.userId,
          membershipId: context.membershipId,
          activeOrganizationId: context.organizationId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          requestId: context.requestId,
          actorUserId: context.userId,
          organizationId: context.organizationId,
          action: `${this.kind.toLowerCase()}.signed_out`,
          resourceType: 'session',
          resourceId: sessionId,
          outcome: 'SUCCESS',
        },
      });
    });
  }

  private eligibleMemberships(tx: Prisma.TransactionClient, phone: string) {
    return tx.membership.findMany({
      where: {
        status: 'ACTIVE',
        organization: { type: this.kind, status: { in: ['PENDING', 'ACTIVE'] } },
        user: {
          isActive: true,
          identities: {
            some: { type: 'PHONE', normalizedValue: phone, verifiedAt: { not: null } },
          },
        },
        roles: { some: { role: { organizationType: this.kind } } },
      },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });
  }
}
