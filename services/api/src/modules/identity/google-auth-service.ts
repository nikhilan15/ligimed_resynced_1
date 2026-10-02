import { randomUUID } from 'node:crypto';

import { hashSessionToken, PERMISSIONS } from '@ligimed/auth';
import type { Prisma, PrismaClient, SessionRepository } from '@ligimed/database';

import { AppError } from '../../platform/errors.js';
import type { GoogleIdentity } from './google-identity.js';

type PartnerKind = 'PHARMACY' | 'DEALER';

const unavailable = () =>
  new AppError(
    403,
    'ACCOUNT_ACCESS_UNAVAILABLE',
    'This Google account cannot access this workspace.',
  );

export class GoogleAuthService {
  constructor(
    private readonly database: PrismaClient,
    private readonly sessions: SessionRepository,
    private readonly ttlSeconds: number,
  ) {}

  async partner(
    identity: GoogleIdentity,
    input: { intent: 'LOGIN' | 'REGISTER'; organizationName?: string; membershipId?: string },
    kind: PartnerKind,
    requestId: string,
    previousToken?: string,
  ) {
    if (input.intent === 'REGISTER') {
      const organizationName = input.organizationName?.trim();
      if (!organizationName || organizationName.length < 2 || organizationName.length > 250)
        throw new AppError(400, 'ORGANIZATION_NAME_INVALID', 'Enter your legal organization name.');
      return this.database.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`google:${identity.subject}`}, 0))`;
        const existing = await tx.userIdentity.findUnique({
          where: { type_normalizedValue: { type: 'GOOGLE', normalizedValue: identity.subject } },
        });
        if (
          existing &&
          (await tx.membership.count({
            where: { userId: existing.userId, organization: { type: 'LIGIMED_INTERNAL' } },
          }))
        )
          throw unavailable();
        const user = existing
          ? await tx.user.findUniqueOrThrow({ where: { id: existing.userId } })
          : await tx.user.create({
              data: {
                displayName: identity.displayName || identity.email,
                identities: {
                  create: {
                    type: 'GOOGLE',
                    normalizedValue: identity.subject,
                    verifiedAt: new Date(),
                  },
                },
              },
            });
        if (!user.isActive) throw unavailable();
        const alreadyRegistered = await tx.membership.count({
          where: { userId: user.id, organization: { type: kind }, status: 'ACTIVE' },
        });
        if (alreadyRegistered)
          throw new AppError(
            409,
            'ACCOUNT_ALREADY_REGISTERED',
            'You already have an account. Please sign in.',
          );
        const role = await tx.role.findUnique({
          where: { key: `${kind}_ADMIN`, organizationType: kind },
        });
        if (!role) throw new Error('Partner role is not seeded');
        const organization = await tx.organization.create({
          data: {
            type: kind,
            status: 'PENDING',
            legalName: organizationName,
            slug: `${kind.toLowerCase()}-${randomUUID()}`,
          },
        });
        const membership = await tx.membership.create({
          data: {
            userId: user.id,
            organizationId: organization.id,
            status: 'ACTIVE',
            joinedAt: new Date(),
            roles: { create: { roleId: role.id } },
          },
        });
        const session = await this.sessions.createInTransaction(tx, {
          userId: user.id,
          membershipId: membership.id,
          organizationId: organization.id,
          scope: 'ONBOARDING',
          assuranceLevel: 'GOOGLE',
          ttlSeconds: this.ttlSeconds,
        });
        await this.revokeAndAudit(
          tx,
          previousToken,
          requestId,
          user.id,
          organization.id,
          session.id,
          `${kind.toLowerCase()}.registered`,
        );
        return { status: 'AUTHENTICATED' as const, session };
      });
    }

    const matches = await this.database.membership.findMany({
      where: {
        status: 'ACTIVE',
        organization: { type: kind, status: { in: ['PENDING', 'ACTIVE'] } },
        user: {
          isActive: true,
          identities: {
            some: { type: 'GOOGLE', normalizedValue: identity.subject, verifiedAt: { not: null } },
          },
        },
        roles: { some: { role: { organizationType: kind } } },
      },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!matches.length) throw unavailable();
    if (matches.length > 1 && !input.membershipId) {
      return {
        status: kind === 'PHARMACY' ? ('SELECT_PHARMACY' as const) : ('SELECT_DEALER' as const),
        memberships: matches.map((item) => ({ id: item.id, name: item.organization.legalName })),
      };
    }
    const selected = matches.find((item) => item.id === (input.membershipId ?? matches[0]!.id));
    if (!selected) throw unavailable();
    const session = await this.database.$transaction(async (tx) => {
      const issued = await this.sessions.createInTransaction(tx, {
        userId: selected.userId,
        membershipId: selected.id,
        organizationId: selected.organizationId,
        scope: selected.organization.status === 'PENDING' ? 'ONBOARDING' : 'FULL',
        assuranceLevel: 'GOOGLE',
        ttlSeconds: this.ttlSeconds,
      });
      await this.revokeAndAudit(
        tx,
        previousToken,
        requestId,
        selected.userId,
        selected.organizationId,
        issued.id,
        `${kind.toLowerCase()}.signed_in`,
      );
      return issued;
    });
    return { status: 'AUTHENTICATED' as const, session };
  }

  async admin(identity: GoogleIdentity, requestId: string, previousToken?: string) {
    return this.database.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`google:${identity.subject}`}, 0))`;
      const google = await tx.userIdentity.findUnique({
        where: { type_normalizedValue: { type: 'GOOGLE', normalizedValue: identity.subject } },
      });
      let userId = google?.userId;
      if (
        userId &&
        (await tx.membership.count({
          where: { userId, organization: { type: { not: 'LIGIMED_INTERNAL' } } },
        }))
      )
        throw unavailable();
      if (!userId) {
        // A verified Gmail address is authoritative for this account. Other domains need
        // explicit Google subject provisioning; never attach a partner by email alone.
        if (!identity.email.endsWith('@gmail.com')) throw unavailable();
        const invitation = await tx.userIdentity.findUnique({
          where: { type_normalizedValue: { type: 'EMAIL', normalizedValue: identity.email } },
          include: { user: { include: { memberships: { include: { organization: true } } } } },
        });
        if (
          !invitation ||
          invitation.user.memberships.some((m) => m.organization.type !== 'LIGIMED_INTERNAL')
        )
          throw unavailable();
        userId = invitation.userId;
        await tx.userIdentity.create({
          data: {
            userId,
            type: 'GOOGLE',
            normalizedValue: identity.subject,
            verifiedAt: new Date(),
          },
        });
      }
      const memberships = await tx.membership.findMany({
        where: {
          userId,
          status: 'ACTIVE',
          organization: { type: 'LIGIMED_INTERNAL', status: 'ACTIVE' },
          user: { isActive: true },
          roles: {
            some: {
              role: {
                organizationType: 'LIGIMED_INTERNAL',
                permissions: { some: { permission: { key: PERMISSIONS.KYC_REVIEW } } },
              },
            },
          },
        },
        take: 2,
      });
      if (memberships.length !== 1) throw unavailable();
      const membership = memberships[0]!;
      const session = await this.sessions.createInTransaction(tx, {
        userId: membership.userId,
        membershipId: membership.id,
        organizationId: membership.organizationId,
        scope: 'FULL',
        assuranceLevel: 'GOOGLE',
        ttlSeconds: this.ttlSeconds,
      });
      await this.revokeAndAudit(
        tx,
        previousToken,
        requestId,
        membership.userId,
        membership.organizationId,
        session.id,
        'admin.signed_in',
      );
      return session;
    });
  }

  private async revokeAndAudit(
    tx: Prisma.TransactionClient,
    previousToken: string | undefined,
    requestId: string,
    userId: string,
    organizationId: string,
    sessionId: string,
    action: string,
  ) {
    if (previousToken) {
      await tx.session.updateMany({
        where: { tokenHash: hashSessionToken(previousToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await tx.auditLog.create({
      data: {
        requestId,
        actorUserId: userId,
        organizationId,
        action,
        resourceType: 'session',
        resourceId: sessionId,
        outcome: 'SUCCESS',
      },
    });
  }
}
