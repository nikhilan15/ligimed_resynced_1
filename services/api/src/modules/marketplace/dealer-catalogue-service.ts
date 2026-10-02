import { createHash } from 'node:crypto';

import { AuthorizationError, PERMISSIONS, requirePermission } from '@ligimed/auth';
import { Prisma, type PrismaClient } from '@ligimed/database';
import type { RequestContext } from '@ligimed/types';
import type {
  DealerCatalogueListingInput,
  DealerCatalogueListingUpdate,
} from '@ligimed/validation';

import { AppError } from '../../platform/errors.js';

interface CatalogueQuery {
  q?: string | undefined;
  availability: 'ALL' | 'AVAILABLE' | 'UNAVAILABLE';
  cursor?: string | undefined;
  limit: number;
}

function slugFor(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96);
  const digest = createHash('sha256').update(value.trim().toLowerCase()).digest('hex').slice(0, 12);
  return `${normalized || 'item'}-${digest}`;
}

export class DealerCatalogueService {
  constructor(private readonly database: PrismaClient) {}

  async list(sessionId: string, context: RequestContext, query: CatalogueQuery) {
    await this.authorize(sessionId, context);
    const search = query.q?.trim();
    const records = await this.database.dealerCatalogueItem.findMany({
      where: {
        organizationId: context.organizationId,
        ...(query.availability === 'AVAILABLE'
          ? { isAvailable: true }
          : query.availability === 'UNAVAILABLE'
            ? { isAvailable: false }
            : {}),
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
        ...(search
          ? {
              OR: [
                { sku: { contains: search, mode: 'insensitive' as const } },
                { product: { name: { contains: search, mode: 'insensitive' as const } } },
                {
                  product: {
                    genericName: { contains: search, mode: 'insensitive' as const },
                  },
                },
                {
                  product: {
                    manufacturer: { name: { contains: search, mode: 'insensitive' as const } },
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
      include: { product: { include: { manufacturer: true, category: true } } },
    });
    const hasMore = records.length > query.limit;
    const page = records.slice(0, query.limit);
    return {
      products: page.map((record) => this.publicListing(record)),
      page: { nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null, hasMore },
    };
  }

  async detail(sessionId: string, context: RequestContext, listingId: string) {
    await this.authorize(sessionId, context);
    return this.publicListing(await this.scopedListing(context.organizationId, listingId));
  }

  async create(sessionId: string, context: RequestContext, input: DealerCatalogueListingInput) {
    await this.authorize(sessionId, context);
    try {
      const listing = await this.database.$transaction(async (transaction) => {
        await this.lockOrganization(transaction, context.organizationId);
        const manufacturer = input.manufacturerName
          ? await transaction.manufacturer.upsert({
              where: { slug: slugFor(input.manufacturerName) },
              create: { name: input.manufacturerName, slug: slugFor(input.manufacturerName) },
              update: {},
            })
          : null;
        const category = input.categoryName
          ? await transaction.productCategory.upsert({
              where: { slug: slugFor(input.categoryName) },
              create: { name: input.categoryName, slug: slugFor(input.categoryName) },
              update: {},
            })
          : null;
        const productWhere = {
          name: { equals: input.name, mode: 'insensitive' as const },
          genericName: input.genericName,
          strength: input.strength,
          dosageForm: input.dosageForm,
          packSize: input.packSize,
          manufacturerId: manufacturer?.id ?? null,
          categoryId: category?.id ?? null,
        };
        let product = await transaction.product.findFirst({ where: productWhere });
        product ??= await transaction.product.create({
          data: {
            ...(manufacturer ? { manufacturerId: manufacturer.id } : {}),
            ...(category ? { categoryId: category.id } : {}),
            name: input.name,
            genericName: input.genericName,
            strength: input.strength,
            dosageForm: input.dosageForm,
            packSize: input.packSize,
            description: input.description,
          },
        });
        const existing = await transaction.dealerCatalogueItem.findUnique({
          where: {
            organizationId_productId: {
              organizationId: context.organizationId,
              productId: product.id,
            },
          },
          select: { id: true },
        });
        if (existing) {
          throw new AppError(
            409,
            'CATALOGUE_LISTING_EXISTS',
            'This product is already in the dealer catalogue.',
          );
        }
        const created = await transaction.dealerCatalogueItem.create({
          data: {
            organizationId: context.organizationId,
            productId: product.id,
            sku: input.sku,
            unitPriceMinor: BigInt(input.unitPriceMinor),
            currency: input.currency,
            minimumQuantity: input.minimumQuantity,
            isAvailable: input.isAvailable,
          },
          include: { product: { include: { manufacturer: true, category: true } } },
        });
        await transaction.auditLog.create({
          data: {
            requestId: context.requestId,
            actorUserId: context.userId,
            organizationId: context.organizationId,
            action: 'dealer.catalogue_listing_created',
            resourceType: 'dealer_catalogue_item',
            resourceId: created.id,
            outcome: 'SUCCESS',
            details: { productId: product.id, available: created.isAvailable },
          },
        });
        await transaction.outboxEvent.create({
          data: {
            aggregateType: 'dealer_catalogue_item',
            aggregateId: created.id,
            eventType: 'dealer.catalogue.listing_created',
            payload: { organizationId: context.organizationId, productId: product.id },
          },
        });
        return created;
      });
      return this.publicListing(listing);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(
          409,
          'CATALOGUE_LISTING_EXISTS',
          'This product is already in the dealer catalogue.',
        );
      }
      throw error;
    }
  }

  async update(
    sessionId: string,
    context: RequestContext,
    listingId: string,
    input: DealerCatalogueListingUpdate,
  ) {
    await this.authorize(sessionId, context);
    return this.database.$transaction(async (transaction) => {
      await this.lockOrganization(transaction, context.organizationId);
      const existing = await transaction.dealerCatalogueItem.findFirst({
        where: { id: listingId, organizationId: context.organizationId },
        select: { id: true, productId: true },
      });
      if (!existing) {
        throw new AppError(404, 'CATALOGUE_LISTING_NOT_FOUND', 'Catalogue listing was not found.');
      }
      const updated = await transaction.dealerCatalogueItem.update({
        where: { id: existing.id },
        data: {
          sku: input.sku,
          unitPriceMinor: BigInt(input.unitPriceMinor),
          currency: input.currency,
          minimumQuantity: input.minimumQuantity,
          isAvailable: input.isAvailable,
        },
        include: { product: { include: { manufacturer: true, category: true } } },
      });
      await transaction.auditLog.create({
        data: {
          requestId: context.requestId,
          actorUserId: context.userId,
          organizationId: context.organizationId,
          action: 'dealer.catalogue_listing_updated',
          resourceType: 'dealer_catalogue_item',
          resourceId: updated.id,
          outcome: 'SUCCESS',
          details: { available: updated.isAvailable },
        },
      });
      await transaction.outboxEvent.create({
        data: {
          aggregateType: 'dealer_catalogue_item',
          aggregateId: updated.id,
          eventType: 'dealer.catalogue.listing_updated',
          payload: { organizationId: context.organizationId, productId: existing.productId },
        },
      });
      return this.publicListing(updated);
    });
  }

  private async scopedListing(organizationId: string, listingId: string) {
    const listing = await this.database.dealerCatalogueItem.findFirst({
      where: { id: listingId, organizationId },
      include: { product: { include: { manufacturer: true, category: true } } },
    });
    if (!listing) {
      throw new AppError(404, 'CATALOGUE_LISTING_NOT_FOUND', 'Catalogue listing was not found.');
    }
    return listing;
  }

  private publicListing(record: {
    id: string;
    sku: string | null;
    unitPriceMinor: bigint;
    currency: string;
    minimumQuantity: number;
    isAvailable: boolean;
    createdAt: Date;
    updatedAt: Date;
    product: {
      id: string;
      name: string;
      genericName: string | null;
      strength: string | null;
      dosageForm: string | null;
      packSize: string | null;
      description: string | null;
      manufacturer: { name: string } | null;
      category: { name: string } | null;
    };
  }) {
    return {
      listingId: record.id,
      id: record.product.id,
      name: record.product.name,
      genericName: record.product.genericName,
      strength: record.product.strength,
      dosageForm: record.product.dosageForm,
      packSize: record.product.packSize,
      description: record.product.description,
      manufacturer: record.product.manufacturer?.name ?? null,
      category: record.product.category?.name ?? null,
      sku: record.sku,
      unitPrice: { amountMinor: record.unitPriceMinor.toString(), currency: record.currency },
      minimumQuantity: record.minimumQuantity,
      isAvailable: record.isAvailable,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private async authorize(sessionId: string, context: RequestContext) {
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
        membership: {
          status: 'ACTIVE',
          organizationId: context.organizationId,
          roles: { some: { role: { organizationType: 'DEALER' } } },
        },
        activeOrganization: { type: 'DEALER', status: 'ACTIVE' },
      },
      select: { id: true },
    });
    if (!session) throw new AuthorizationError();
    requirePermission(context, PERMISSIONS.CATALOGUE_MANAGE);
  }

  private async lockOrganization(transaction: Prisma.TransactionClient, organizationId: string) {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM organizations
      WHERE id = ${organizationId}::uuid AND type = 'DEALER' AND status = 'ACTIVE'
      FOR UPDATE
    `;
    if (rows.length !== 1) throw new AuthorizationError();
  }
}
