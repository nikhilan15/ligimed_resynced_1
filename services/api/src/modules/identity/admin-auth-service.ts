import {
  AuthorizationError,
  hashSessionToken,
  PERMISSIONS,
  requirePermission,
} from '@ligimed/auth';
import type { OtpRepository, PrismaClient, SessionRepository } from '@ligimed/database';
import type { RequestContext } from '@ligimed/types';
import { adminOtpRequestSchema } from '@ligimed/validation';

import { AppError } from '../../platform/errors.js';
import type { OtpProvider } from './otp-provider.js';

const invalidCode = () =>
  new AppError(400, 'OTP_INVALID', 'The code is invalid, expired or already used.');

export class AdminAuthService {
  constructor(
    private readonly database: PrismaClient,
    private readonly otp: OtpRepository,
    private readonly sessions: SessionRepository,
    private readonly provider: OtpProvider,
    private readonly ttlSeconds: number,
  ) {}

  async requestCode(body: unknown, browserToken: string) {
    const input = adminOtpRequestSchema.parse(body);
    const challenge = await this.otp.issue({ identifier: input.phoneNumber, purpose: 'SIGN_IN' });
    try {
      await this.database.adminAuthAttempt.create({
        data: { challengeId: challenge.id, browserTokenHash: hashSessionToken(browserToken) },
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
    const attempt = await this.database.adminAuthAttempt.findFirst({
      where: {
        challengeId: input.challengeId,
        browserTokenHash: hashSessionToken(browserToken),
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
    await this.database.adminAuthAttempt.update({
      where: { challengeId: input.challengeId },
      data: { verifiedAt: new Date() },
    });

    return this.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "challengeId" FROM admin_auth_attempts WHERE "challengeId" = ${input.challengeId}::uuid FOR UPDATE`;
      const verifiedAttempt = await transaction.adminAuthAttempt.findFirst({
        where: {
          challengeId: input.challengeId,
          browserTokenHash: hashSessionToken(browserToken),
          verifiedAt: { not: null },
          completedAt: null,
        },
        include: { challenge: true },
      });
      if (
        !verifiedAttempt ||
        verifiedAttempt.challenge.status !== 'VERIFIED' ||
        verifiedAttempt.challenge.expiresAt.getTime() <= Date.now()
      )
        throw invalidCode();

      const memberships = await transaction.membership.findMany({
        where: {
          status: 'ACTIVE',
          organization: { type: 'LIGIMED_INTERNAL', status: 'ACTIVE' },
          user: {
            isActive: true,
            identities: {
              some: {
                type: 'PHONE',
                normalizedValue: verifiedAttempt.challenge.identifier,
                verifiedAt: { not: null },
              },
            },
          },
          roles: {
            some: {
              role: {
                organizationType: 'LIGIMED_INTERNAL',
                permissions: { some: { permission: { key: PERMISSIONS.KYC_REVIEW } } },
              },
            },
          },
        },
        include: { organization: true },
        take: 2,
      });
      if (memberships.length !== 1) {
        throw new AppError(
          403,
          'ADMIN_ACCESS_UNAVAILABLE',
          'This identity cannot access LigiMed administration.',
        );
      }
      const membership = memberships[0]!;
      const session = await this.sessions.createInTransaction(transaction, {
        userId: membership.userId,
        membershipId: membership.id,
        organizationId: membership.organizationId,
        scope: 'FULL',
        ttlSeconds: this.ttlSeconds,
      });
      if (previousToken) {
        await transaction.session.updateMany({
          where: { tokenHash: hashSessionToken(previousToken), revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await transaction.adminAuthAttempt.update({
        where: { challengeId: input.challengeId },
        data: { completedAt: new Date() },
      });
      await transaction.auditLog.create({
        data: {
          requestId,
          actorUserId: membership.userId,
          organizationId: membership.organizationId,
          action: 'admin.signed_in',
          resourceType: 'session',
          resourceId: session.id,
          outcome: 'SUCCESS',
        },
      });
      return session;
    });
  }

  async account(sessionId: string, context: RequestContext) {
    requirePermission(context, PERMISSIONS.KYC_REVIEW);
    const session = await this.database.session.findFirst({
      where: {
        id: sessionId,
        scope: 'FULL',
        userId: context.userId,
        membershipId: context.membershipId,
        activeOrganizationId: context.organizationId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { isActive: true },
        membership: { status: 'ACTIVE', organizationId: context.organizationId },
        activeOrganization: { type: 'LIGIMED_INTERNAL', status: 'ACTIVE' },
      },
      select: {
        expiresAt: true,
        user: { select: { id: true, displayName: true } },
        activeOrganization: { select: { id: true, legalName: true } },
      },
    });
    if (!session) throw new AuthorizationError();
    return {
      user: session.user,
      organization: {
        id: session.activeOrganization.id,
        name: session.activeOrganization.legalName,
      },
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  async logout(sessionId: string, context: RequestContext) {
    const result = await this.database.session.updateMany({
      where: {
        id: sessionId,
        userId: context.userId,
        membershipId: context.membershipId,
        activeOrganizationId: context.organizationId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    if (result.count !== 1) throw new AuthorizationError();
  }
}
