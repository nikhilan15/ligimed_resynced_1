import { randomUUID } from 'node:crypto';

import { indianPhoneNumberSchema } from '@ligimed/validation';

import { createDatabaseClient } from './index.js';

if (process.env['NODE_ENV'] === 'production') {
  throw new Error('The development admin provisioner cannot run in production.');
}
const phone = indianPhoneNumberSchema.parse(process.argv[2]);
const displayName = process.argv[3]?.trim();
if (!displayName || displayName.length < 2 || displayName.length > 200) {
  throw new Error('Usage: pnpm admin:provision -- +91XXXXXXXXXX "Reviewer name"');
}
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required.');
const database = createDatabaseClient({ databaseUrl });

try {
  const result = await database.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(182917, 2)`;
    const role = await transaction.role.findUnique({ where: { key: 'LIGIMED_COMPLIANCE' } });
    if (!role) throw new Error('Run the RBAC seed before provisioning an administrator.');
    const organization = await transaction.organization.upsert({
      where: { slug: 'ligimed-internal' },
      create: {
        type: 'LIGIMED_INTERNAL',
        status: 'ACTIVE',
        legalName: 'LigiMed Internal Operations',
        slug: 'ligimed-internal',
      },
      update: { status: 'ACTIVE' },
    });
    let identity = await transaction.userIdentity.findUnique({
      where: { type_normalizedValue: { type: 'PHONE', normalizedValue: phone } },
      include: { user: { include: { memberships: { include: { organization: true } } } } },
    });
    if (
      identity?.user.memberships.some(
        (membership) => membership.organization.type !== 'LIGIMED_INTERNAL',
      )
    ) {
      throw new Error(
        'An internal reviewer identity cannot also belong to a partner organization.',
      );
    }
    if (!identity) {
      identity = await transaction.userIdentity.create({
        data: {
          type: 'PHONE',
          normalizedValue: phone,
          verifiedAt: new Date(),
          user: { create: { displayName } },
        },
        include: { user: { include: { memberships: { include: { organization: true } } } } },
      });
    }
    const membership = await transaction.membership.upsert({
      where: {
        userId_organizationId: {
          userId: identity.userId,
          organizationId: organization.id,
        },
      },
      create: {
        userId: identity.userId,
        organizationId: organization.id,
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
      update: { status: 'ACTIVE', joinedAt: new Date() },
    });
    await transaction.membershipRole.upsert({
      where: { membershipId_roleId: { membershipId: membership.id, roleId: role.id } },
      create: { membershipId: membership.id, roleId: role.id },
      update: {},
    });
    await transaction.auditLog.create({
      data: {
        requestId: `development-provision-${randomUUID()}`,
        organizationId: organization.id,
        action: 'development.admin_provisioned',
        resourceType: 'user',
        resourceId: identity.userId,
        outcome: 'SUCCESS',
      },
    });
    return { userId: identity.userId, organizationId: organization.id };
  });
  process.stdout.write(`Development compliance reviewer ready: ${result.userId}\n`);
} finally {
  await database.$disconnect();
}
