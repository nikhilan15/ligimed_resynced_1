import { AuthorizationError, requirePermission, type Permission } from '@ligimed/auth';
import type { Prisma, PrismaClient } from '@ligimed/database';
import type { RequestContext } from '@ligimed/types';

export async function authorizeActivePharmacy(
  database: PrismaClient | Prisma.TransactionClient,
  sessionId: string,
  context: RequestContext,
  permission: Permission,
): Promise<void> {
  requirePermission(context, permission);
  const eligible = await database.$queryRaw<Array<{ id: string }>>`
    SELECT s.id FROM sessions s
    JOIN memberships m ON m.id = s."membershipId"
    JOIN users u ON u.id = s."userId"
    JOIN organizations o ON o.id = s."activeOrganizationId"
    WHERE s.id = ${sessionId}::uuid
      AND s."userId" = ${context.userId}::uuid
      AND s."membershipId" = ${context.membershipId}::uuid
      AND s."activeOrganizationId" = ${context.organizationId}::uuid
      AND s."revokedAt" IS NULL AND s."expiresAt" > CURRENT_TIMESTAMP
      AND s.scope = 'FULL' AND m.status = 'ACTIVE' AND u."isActive" = true
      AND m."userId" = u.id AND m."organizationId" = o.id
      AND o.type = 'PHARMACY' AND o.status = 'ACTIVE'
    FOR SHARE OF s, m, u, o
  `;
  if (eligible.length !== 1) throw new AuthorizationError();
}
