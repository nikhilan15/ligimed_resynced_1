import { createDatabaseClient } from './index.js';
import { seedRbac } from './seed-rbac.js';

if (process.env['NODE_ENV'] === 'production') {
  throw new Error('Demo accounts cannot be provisioned in production.');
}
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required.');
const database = createDatabaseClient({ databaseUrl });

const accounts = {
  pharmacy: { phone: '+919111111111', name: 'Asha Sharma', organization: 'LigiMed Demo Pharmacy' },
  dealer: { phone: '+919222222222', name: 'Ravi Kumar', organization: 'LigiMed Demo Distributors' },
  admin: { phone: '+919999999999', name: 'Local Compliance Reviewer' },
} as const;

async function partner(
  transaction: Parameters<Parameters<typeof database.$transaction>[0]>[0],
  input: {
    phone: string;
    name: string;
    organization: string;
    type: 'PHARMACY' | 'DEALER';
    role: 'PHARMACY_ADMIN' | 'DEALER_ADMIN';
    slug: string;
  },
) {
  const role = await transaction.role.findUniqueOrThrow({ where: { key: input.role } });
  const organization = await transaction.organization.upsert({
    where: { slug: input.slug },
    create: {
      type: input.type,
      status: 'ACTIVE',
      legalName: input.organization,
      tradeName: input.organization,
      slug: input.slug,
    },
    update: { status: 'ACTIVE', legalName: input.organization, tradeName: input.organization },
  });
  const identity = await transaction.userIdentity.upsert({
    where: { type_normalizedValue: { type: 'PHONE', normalizedValue: input.phone } },
    create: {
      type: 'PHONE',
      normalizedValue: input.phone,
      verifiedAt: new Date(),
      user: { create: { displayName: input.name } },
    },
    update: {
      verifiedAt: new Date(),
      user: { update: { displayName: input.name, isActive: true } },
    },
  });
  const membership = await transaction.membership.upsert({
    where: { userId_organizationId: { userId: identity.userId, organizationId: organization.id } },
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
  const address =
    (await transaction.address.findFirst({ where: { organizationId: organization.id } })) ??
    (await transaction.address.create({
      data: {
        organizationId: organization.id,
        name: input.organization,
        line1: '12 Health Avenue',
        city: 'Chennai',
        district: 'Chennai',
        state: 'Tamil Nadu',
        stateCode: 'TN',
        postalCode: '600001',
      },
    }));
  if (input.type === 'PHARMACY') {
    await transaction.pharmacyProfile.upsert({
      where: { organizationId: organization.id },
      create: {
        organizationId: organization.id,
        primaryAddressId: address.id,
        operationalEmail: 'pharmacy.demo@ligimed.local',
      },
      update: { primaryAddressId: address.id, operationalEmail: 'pharmacy.demo@ligimed.local' },
    });
  } else {
    await transaction.dealerProfile.upsert({
      where: { organizationId: organization.id },
      create: {
        organizationId: organization.id,
        primaryAddressId: address.id,
        operationalEmail: 'dealer.demo@ligimed.local',
      },
      update: { primaryAddressId: address.id, operationalEmail: 'dealer.demo@ligimed.local' },
    });
    await transaction.dealerPublicProfile.upsert({
      where: { organizationId: organization.id },
      create: {
        organizationId: organization.id,
        city: 'Chennai',
        state: 'Tamil Nadu',
        serviceAreas: ['Chennai', 'Kanchipuram'],
        summary: 'Development distributor for testing the LigiMed marketplace.',
      },
      update: { city: 'Chennai', state: 'Tamil Nadu', serviceAreas: ['Chennai', 'Kanchipuram'] },
    });
  }
  await transaction.kycRecord.upsert({
    where: { organizationId_revision: { organizationId: organization.id, revision: 1 } },
    create: {
      organizationId: organization.id,
      revision: 1,
      status: 'VERIFIED',
      authorizedRepresentativeName: input.name,
      authorizedRepresentativeRole: 'Owner',
      declarationAcceptedAt: new Date(),
      submittedAt: new Date(),
      reviewedAt: new Date(),
      createdById: identity.userId,
      updatedById: identity.userId,
    },
    update: { status: 'VERIFIED', reviewedAt: new Date(), updatedById: identity.userId },
  });
  return { organization, userId: identity.userId };
}

try {
  await seedRbac(database);
  await database.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(182917, 3)`;
    const pharmacy = await partner(transaction, {
      ...accounts.pharmacy,
      type: 'PHARMACY',
      role: 'PHARMACY_ADMIN',
      slug: 'ligimed-demo-pharmacy',
    });
    const dealer = await partner(transaction, {
      ...accounts.dealer,
      type: 'DEALER',
      role: 'DEALER_ADMIN',
      slug: 'ligimed-demo-distributors',
    });

    const adminRole = await transaction.role.findUniqueOrThrow({
      where: { key: 'LIGIMED_COMPLIANCE' },
    });
    const internal = await transaction.organization.upsert({
      where: { slug: 'ligimed-internal' },
      create: {
        type: 'LIGIMED_INTERNAL',
        status: 'ACTIVE',
        legalName: 'LigiMed Internal Operations',
        slug: 'ligimed-internal',
      },
      update: { status: 'ACTIVE' },
    });
    const adminIdentity = await transaction.userIdentity.upsert({
      where: { type_normalizedValue: { type: 'PHONE', normalizedValue: accounts.admin.phone } },
      create: {
        type: 'PHONE',
        normalizedValue: accounts.admin.phone,
        verifiedAt: new Date(),
        user: { create: { displayName: accounts.admin.name } },
      },
      update: {
        verifiedAt: new Date(),
        user: { update: { displayName: accounts.admin.name, isActive: true } },
      },
    });
    const adminMembership = await transaction.membership.upsert({
      where: {
        userId_organizationId: { userId: adminIdentity.userId, organizationId: internal.id },
      },
      create: {
        userId: adminIdentity.userId,
        organizationId: internal.id,
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
      update: { status: 'ACTIVE', joinedAt: new Date() },
    });
    await transaction.membershipRole.upsert({
      where: { membershipId_roleId: { membershipId: adminMembership.id, roleId: adminRole.id } },
      create: { membershipId: adminMembership.id, roleId: adminRole.id },
      update: {},
    });

    const manufacturer = await transaction.manufacturer.upsert({
      where: { slug: 'demo-health-labs' },
      create: { name: 'Demo Health Labs', slug: 'demo-health-labs' },
      update: { name: 'Demo Health Labs' },
    });
    const category = await transaction.productCategory.upsert({
      where: { slug: 'general-medicines' },
      create: { name: 'General Medicines', slug: 'general-medicines' },
      update: { name: 'General Medicines' },
    });
    const medicines = [
      {
        name: 'Paracetamol 500',
        genericName: 'Paracetamol',
        strength: '500 mg',
        dosageForm: 'Tablet',
        packSize: '10 tablets',
        price: 1850n,
        sku: 'DHL-PARA-500',
      },
      {
        name: 'Cetirizine 10',
        genericName: 'Cetirizine',
        strength: '10 mg',
        dosageForm: 'Tablet',
        packSize: '10 tablets',
        price: 2400n,
        sku: 'DHL-CET-10',
      },
      {
        name: 'ORS Sachet',
        genericName: 'Oral Rehydration Salts',
        strength: null,
        dosageForm: 'Powder',
        packSize: '21 g sachet',
        price: 2200n,
        sku: 'DHL-ORS-21',
      },
    ];
    for (const medicine of medicines) {
      let product = await transaction.product.findFirst({
        where: { name: medicine.name, manufacturerId: manufacturer.id },
      });
      product ??= await transaction.product.create({
        data: {
          manufacturerId: manufacturer.id,
          categoryId: category.id,
          name: medicine.name,
          genericName: medicine.genericName,
          strength: medicine.strength,
          dosageForm: medicine.dosageForm,
          packSize: medicine.packSize,
          description: 'Development catalogue item for local testing.',
        },
      });
      await transaction.dealerCatalogueItem.upsert({
        where: {
          organizationId_productId: {
            organizationId: dealer.organization.id,
            productId: product.id,
          },
        },
        create: {
          organizationId: dealer.organization.id,
          productId: product.id,
          sku: medicine.sku,
          unitPriceMinor: medicine.price,
          minimumQuantity: 1,
          isAvailable: true,
        },
        update: { sku: medicine.sku, unitPriceMinor: medicine.price, isAvailable: true },
      });
      const inventory = await transaction.inventoryItem.upsert({
        where: {
          organizationId_productId: {
            organizationId: pharmacy.organization.id,
            productId: product.id,
          },
        },
        create: {
          organizationId: pharmacy.organization.id,
          productId: product.id,
          reorderLevel: 10,
        },
        update: {},
      });
      const batch = await transaction.inventoryBatch.upsert({
        where: {
          inventoryItemId_batchNumber: {
            inventoryItemId: inventory.id,
            batchNumber: `DEMO-${medicine.sku}`,
          },
        },
        create: {
          inventoryItemId: inventory.id,
          batchNumber: `DEMO-${medicine.sku}`,
          quantityOnHand: 25,
          purchasePriceMinor: medicine.price,
          expiresAt: new Date('2027-12-31T00:00:00.000Z'),
        },
        update: {},
      });
      const movement = await transaction.stockMovement.findFirst({
        where: { inventoryBatchId: batch.id },
      });
      if (!movement)
        await transaction.stockMovement.create({
          data: {
            inventoryBatchId: batch.id,
            type: 'RECEIPT',
            quantityDelta: batch.quantityOnHand,
            balanceAfter: batch.quantityOnHand,
            reason: 'Demo fixture stock',
            createdById: pharmacy.userId,
          },
        });
    }
  });
  process.stdout.write(JSON.stringify(accounts, null, 2) + '\n');
} finally {
  await database.$disconnect();
}
