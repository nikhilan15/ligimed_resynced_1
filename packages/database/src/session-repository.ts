import { AuthorizationError, createSessionToken, hashSessionToken } from '@ligimed/auth';
import type { RequestContext } from '@ligimed/types';
import { idSchema } from '@ligimed/validation';

import type {
  Prisma,
  PrismaClient,
  SessionAssuranceLevel,
  SessionScope,
} from '../generated/prisma/client.js';

const sessionTokenPattern = /^[A-Za-z0-9_-]{43}$/;

interface SessionInput {
  userId: string;
  membershipId: string;
  organizationId: string;
  ttlSeconds?: number;
  scope?: SessionScope;
  assuranceLevel?: SessionAssuranceLevel;
}

export class SessionRepository {
  constructor(private readonly database: PrismaClient) {}

  async create(input: SessionInput): Promise<{ id: string; token: string; expiresAt: Date }> {
    return this.database.$transaction((transaction) =>
      this.createInTransaction(transaction, input),
    );
  }

  /** Allows identity creation, session issuance and its audit event to commit together. */
  async createInTransaction(transaction: Prisma.TransactionClient, input: SessionInput) {
    const ttlSeconds = input.ttlSeconds ?? 28_800;
    const scope = input.scope ?? 'FULL';
    if (scope !== 'FULL' && scope !== 'ONBOARDING') throw new AuthorizationError();
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 2_592_000) {
      throw new Error('Session lifetime must be between 1 and 2592000 seconds');
    }
    if (
      ![input.userId, input.membershipId, input.organizationId].every(
        (id) => idSchema.safeParse(id).success,
      )
    ) {
      throw new AuthorizationError();
    }

    // Hold authorization rows until issuance commits, including concurrent suspension/revocation.
    const eligible = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT m.id FROM memberships m
        JOIN users u ON u.id = m."userId"
        JOIN organizations o ON o.id = m."organizationId"
        WHERE m.id = ${input.membershipId}::uuid AND m."userId" = ${input.userId}::uuid
          AND m."organizationId" = ${input.organizationId}::uuid
          AND m.status = 'ACTIVE' AND u."isActive" = true
          AND ((o.status = 'ACTIVE' AND ${scope} = 'FULL') OR
               (o.status = 'PENDING' AND o.type IN ('PHARMACY', 'DEALER') AND ${scope} = 'ONBOARDING'
                AND EXISTS (
                  SELECT 1 FROM membership_roles mr
                  JOIN roles r ON r.id = mr."roleId"
                  WHERE mr."membershipId" = m.id AND r."organizationType" = o.type
                )))
        FOR SHARE OF m, u, o
      `;
    if (eligible.length !== 1) throw new AuthorizationError();
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1_000);
    const session = await transaction.session.create({
      data: {
        tokenHash: hashSessionToken(token),
        userId: input.userId,
        membershipId: input.membershipId,
        activeOrganizationId: input.organizationId,
        scope,
        assuranceLevel: input.assuranceLevel ?? 'OTP',
        expiresAt,
      },
      select: { id: true },
    });
    return { id: session.id, token, expiresAt };
  }

  async resolve(
    token: string,
    requestId: string,
  ): Promise<{ id: string; context: RequestContext; expiresAt: Date } | null> {
    if (!sessionTokenPattern.test(token)) return null;
    const session = await this.database.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: {
        user: true,
        activeOrganization: true,
        membership: {
          include: {
            roles: {
              include: { role: { include: { permissions: { include: { permission: true } } } } },
            },
          },
        },
      },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now() ||
      !session.user.isActive ||
      session.membership.status !== 'ACTIVE' ||
      (session.scope === 'FULL'
        ? session.activeOrganization.status !== 'ACTIVE'
        : !['PHARMACY', 'DEALER'].includes(session.activeOrganization.type) ||
          !['PENDING', 'ACTIVE'].includes(session.activeOrganization.status) ||
          !session.membership.roles.some(
            (assignment) => assignment.role.organizationType === session.activeOrganization.type,
          )) ||
      session.membership.userId !== session.userId ||
      session.membership.organizationId !== session.activeOrganizationId
    )
      return null;

    const permissions = new Set<string>();
    // Onboarding tokens never gain business permissions, even if approval happens mid-session.
    for (const assignment of session.scope === 'FULL' ? session.membership.roles : []) {
      const role = assignment.role;
      if (
        role.organizationType !== null &&
        role.organizationType !== session.activeOrganization.type
      )
        continue;
      for (const grant of role.permissions) permissions.add(grant.permission.key);
    }
    return {
      id: session.id,
      expiresAt: session.expiresAt,
      context: {
        requestId,
        userId: session.userId,
        organizationId: session.activeOrganizationId,
        membershipId: session.membershipId,
        permissions,
      },
    };
  }

  /** Caller must supply a context produced by authenticated session resolution. */
  async revoke(id: string, context: RequestContext): Promise<boolean> {
    if (!idSchema.safeParse(id).success) return false;
    const result = await this.database.session.updateMany({
      where: {
        id,
        userId: context.userId,
        activeOrganizationId: context.organizationId,
        membershipId: context.membershipId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    return result.count === 1;
  }

  /** Possession of the raw secret authorizes revocation only of that same session. */
  async revokeToken(token: string): Promise<boolean> {
    if (!sessionTokenPattern.test(token)) return false;
    const result = await this.database.session.updateMany({
      where: { tokenHash: hashSessionToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count === 1;
  }
}
