import { AuthorizationError, requirePermission, type Permission } from '@ligimed/auth';
import type { Prisma, PrismaClient } from '@ligimed/database';
import type { RequestContext } from '@ligimed/types';

export async function authorizeInternal(
  database: PrismaClient | Prisma.TransactionClient,
  sessionId: string,
  context: RequestContext,
  permission: Permission,
) {
  requirePermission(context, permission);
  const rows = await database.$queryRaw<Array<{ id: string }>>`
    SELECT s.id FROM sessions s
    JOIN memberships m ON m.id = s."membershipId"
    JOIN users u ON u.id = s."userId"
    JOIN organizations o ON o.id = s."activeOrganizationId"
    WHERE s.id = ${sessionId}::uuid AND s."userId" = ${context.userId}::uuid
      AND s."membershipId" = ${context.membershipId}::uuid
      AND s."activeOrganizationId" = ${context.organizationId}::uuid
      AND s."revokedAt" IS NULL AND s."expiresAt" > CURRENT_TIMESTAMP
      AND s.scope = 'FULL' AND m.status = 'ACTIVE' AND u."isActive" = true
      AND m."userId" = u.id AND m."organizationId" = o.id
      AND o.type = 'LIGIMED_INTERNAL' AND o.status = 'ACTIVE'
    FOR SHARE OF s, m, u, o
  `;
  if (rows.length !== 1) throw new AuthorizationError();
}
