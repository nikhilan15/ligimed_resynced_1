import { PERMISSIONS } from '@ligimed/auth';

import type { PrismaClient } from '../generated/prisma/client.js';

const permissionDescriptions: Record<string, string> = {
  [PERMISSIONS.ORGANIZATION_READ]: 'Read the active organization profile',
  [PERMISSIONS.ORGANIZATION_UPDATE]: 'Update the active organization profile',
  [PERMISSIONS.MEMBERSHIP_MANAGE]: 'Invite, update, and revoke organization memberships',
  [PERMISSIONS.AUDIT_READ]: 'Read audit records within the granted scope',
  [PERMISSIONS.KYC_SUBMIT]: 'Submit KYC information for the active organization',
  [PERMISSIONS.KYC_REVIEW]: 'Review organization KYC information',
  [PERMISSIONS.CATALOGUE_MANAGE]: 'Manage the active dealer catalogue',
  [PERMISSIONS.ORDER_CREATE]: 'Create orders for the active pharmacy',
  [PERMISSIONS.ORDER_READ]: 'Read orders scoped to the active organization',
  [PERMISSIONS.ORDER_MANAGE]: 'Manage order status for the active dealer',
  [PERMISSIONS.INVENTORY_READ]: 'Read inventory for the active pharmacy',
  [PERMISSIONS.INVENTORY_MANAGE]: 'Manage inventory for the active pharmacy',
  [PERMISSIONS.CUSTOMER_READ]: 'Read customer records for the active pharmacy',
  [PERMISSIONS.CUSTOMER_MANAGE]: 'Create and update customer records for the active pharmacy',
  [PERMISSIONS.BILLING_READ]: 'Read pharmacy retail sales and dealer purchase invoice records',
  [PERMISSIONS.BILLING_MANAGE]: 'Record pharmacy sales and dealer purchase invoices',
  [PERMISSIONS.DOCUMENT_READ]: 'Read private pharmacy documents',
  [PERMISSIONS.DOCUMENT_MANAGE]: 'Upload pharmacy documents and renewal versions',
  [PERMISSIONS.DOCUMENT_FINANCE]: 'Access private banking and finance documents',
  [PERMISSIONS.DOCUMENT_REVIEW]: 'Review pharmacy documents',
  [PERMISSIONS.DOCUMENT_POLICY]: 'Configure pharmacy document reminders',
};

const roles = [
  {
    key: 'PHARMACY_ADMIN',
    name: 'Pharmacy administrator',
    organizationType: 'PHARMACY' as const,
    permissions: [
      PERMISSIONS.ORGANIZATION_READ,
      PERMISSIONS.ORGANIZATION_UPDATE,
      PERMISSIONS.MEMBERSHIP_MANAGE,
      PERMISSIONS.KYC_SUBMIT,
      PERMISSIONS.ORDER_CREATE,
      PERMISSIONS.ORDER_READ,
      PERMISSIONS.INVENTORY_READ,
      PERMISSIONS.INVENTORY_MANAGE,
      PERMISSIONS.CUSTOMER_READ,
      PERMISSIONS.CUSTOMER_MANAGE,
      PERMISSIONS.BILLING_READ,
      PERMISSIONS.BILLING_MANAGE,
      PERMISSIONS.DOCUMENT_READ,
      PERMISSIONS.DOCUMENT_MANAGE,
      PERMISSIONS.DOCUMENT_FINANCE,
    ],
  },
  {
    key: 'DEALER_ADMIN',
    name: 'Dealer administrator',
    organizationType: 'DEALER' as const,
    permissions: [
      PERMISSIONS.ORGANIZATION_READ,
      PERMISSIONS.ORGANIZATION_UPDATE,
      PERMISSIONS.MEMBERSHIP_MANAGE,
      PERMISSIONS.KYC_SUBMIT,
      PERMISSIONS.CATALOGUE_MANAGE,
      PERMISSIONS.ORDER_READ,
      PERMISSIONS.ORDER_MANAGE,
    ],
  },
  {
    key: 'TRANSPORT_ADMIN',
    name: 'Transport administrator',
    organizationType: 'TRANSPORT' as const,
    permissions: [
      PERMISSIONS.ORGANIZATION_READ,
      PERMISSIONS.ORGANIZATION_UPDATE,
      PERMISSIONS.MEMBERSHIP_MANAGE,
      PERMISSIONS.KYC_SUBMIT,
    ],
  },
  {
    key: 'LIGIMED_COMPLIANCE',
    name: 'LigiMed compliance reviewer',
    organizationType: 'LIGIMED_INTERNAL' as const,
    permissions: [
      PERMISSIONS.ORGANIZATION_READ,
      PERMISSIONS.KYC_REVIEW,
      PERMISSIONS.AUDIT_READ,
      PERMISSIONS.DOCUMENT_REVIEW,
      PERMISSIONS.DOCUMENT_POLICY,
      PERMISSIONS.DOCUMENT_FINANCE,
    ],
  },
] as const;

export async function seedRbac(client: PrismaClient): Promise<void> {
  await client.$transaction(async (database) => {
    // Serializes concurrent seed runs across processes, released on commit or rollback.
    await database.$executeRaw`SELECT pg_advisory_xact_lock(182917, 1)`;
    const permissions = await Promise.all(
      Object.entries(permissionDescriptions).map(([key, description]) =>
        database.permission.upsert({
          where: { key },
          create: { key, description },
          update: { description },
        }),
      ),
    );
    const permissionIds = new Map<string, string>(
      permissions.map((permission: { id: string; key: string }) => [permission.key, permission.id]),
    );

    for (const definition of roles) {
      const role = await database.role.upsert({
        where: { key: definition.key },
        create: {
          key: definition.key,
          name: definition.name,
          organizationType: definition.organizationType,
        },
        update: {
          name: definition.name,
          organizationType: definition.organizationType,
        },
      });

      const permissionAssignments = definition.permissions.map((permission) => {
        const permissionId = permissionIds.get(permission);
        if (!permissionId) throw new Error(`Seed permission not found: ${permission}`);

        return { roleId: role.id, permissionId };
      });

      await database.rolePermission.deleteMany({
        where: {
          roleId: role.id,
          permissionId: { notIn: permissionAssignments.map((item) => item.permissionId) },
        },
      });
      await database.rolePermission.createMany({
        data: permissionAssignments,
        skipDuplicates: true,
      });
    }
  });
}
