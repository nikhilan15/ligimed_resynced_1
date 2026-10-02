import { randomUUID } from 'node:crypto';

import { createDatabaseClient } from './index.js';

if (process.env['NODE_ENV'] === 'production') {
  throw new Error('Use the production identity-administration process to provision reviewers.');
}
const email = process.argv[2]?.trim().toLowerCase();
const displayName = process.argv[3]?.trim();
if (
  !email ||
  !/^[^\s@]+@gmail\.com$/.test(email) ||
  !displayName ||
  displayName.length < 2 ||
  displayName.length > 200
) {
  throw new Error('Usage: pnpm admin:provision:google -- reviewer@gmail.com "Reviewer name"');
}
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required.');
const database = createDatabaseClient({ databaseUrl });

try {
  const result = await database.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(182917, 3)`;
    const role = await tx.role.findUnique({ where: { key: 'LIGIMED_COMPLIANCE' } });
    if (!role) throw new Error('Run the RBAC seed first.');
    const organization = await tx.organization.upsert({
      where: { slug: 'ligimed-internal' },
      create: {
        type: 'LIGIMED_INTERNAL',
        status: 'ACTIVE',
        legalName: 'LigiMed Internal Operations',
        slug: 'ligimed-internal',
      },
      update: { status: 'ACTIVE' },
    });
    const existing = await tx.userIdentity.findUnique({
      where: { type_normalizedValue: { type: 'EMAIL', normalizedValue: email } },
      include: { user: { include: { memberships: { include: { organization: true } } } } },
    });
    if (
      existing?.user.memberships.some(
        (membership) => membership.organization.type !== 'LIGIMED_INTERNAL',
      )
    ) {
      throw new Error('Partner identities cannot be provisioned as internal reviewers.');
    }
    const identity =
      existing ??
      (await tx.userIdentity.create({
        data: { type: 'EMAIL', normalizedValue: email, user: { create: { displayName } } },
      }));
    const membership = await tx.membership.upsert({
      where: {
        userId_organizationId: { userId: identity.userId, organizationId: organization.id },
      },
      create: {
        userId: identity.userId,
        organizationId: organization.id,
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
      update: { status: 'ACTIVE', joinedAt: new Date() },
    });
    await tx.membershipRole.upsert({
      where: { membershipId_roleId: { membershipId: membership.id, roleId: role.id } },
      create: { membershipId: membership.id, roleId: role.id },
      update: {},
    });
    await tx.auditLog.create({
      data: {
        requestId: `development-provision-${randomUUID()}`,
        organizationId: organization.id,
        action: 'development.google_admin_provisioned',
        resourceType: 'user',
        resourceId: identity.userId,
        outcome: 'SUCCESS',
      },
    });
    return identity.userId;
  });
  process.stdout.write(`Google compliance reviewer ready: ${result}\n`);
} finally {
  await database.$disconnect();
}
