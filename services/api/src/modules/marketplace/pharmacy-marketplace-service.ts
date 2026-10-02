import { AuthorizationError, PERMISSIONS, requirePermission } from '@ligimed/auth';
import { Prisma, type PrismaClient } from '@ligimed/database';
import type { RequestContext } from '@ligimed/types';
import type { PharmacyMarketplaceQuery } from '@ligimed/validation';

import { AppError } from '../../platform/errors.js';

interface DealerRow {
  id: string;
  legalName: string;
  tradeName: string | null;
  summary: string | null;
  city: string;
  state: string;
  serviceAreas: string[];
}

export class PharmacyMarketplaceService {
  constructor(private readonly database: PrismaClient) {}

  async listDealers(sessionId: string, context: RequestContext, query: PharmacyMarketplaceQuery) {
    await this.authorizePharmacy(sessionId, context);
    const search = query.q?.trim() ?? '';
    const searchPattern = `%${search}%`;
    const rows = await this.database.$queryRaw<DealerRow[]>(Prisma.sql`
      SELECT
        o.id,
        o."legalName",
        o."tradeName",
        p.summary,
        p.city,
        p.state,
        p."serviceAreas"
      FROM organizations o
      INNER JOIN dealer_public_profiles p ON p."organizationId" = o.id
      INNER JOIN LATERAL (
        SELECT k.status
        FROM kyc_records k
        WHERE k."organizationId" = o.id
        ORDER BY k.revision DESC
        LIMIT 1
      ) latest_kyc ON latest_kyc.status = 'VERIFIED'
      WHERE o.type = 'DEALER'
        AND o.status = 'ACTIVE'
        ${query.cursor ? Prisma.sql`AND o.id > ${query.cursor}::uuid` : Prisma.empty}
        ${
          search
            ? Prisma.sql`AND (
                o."legalName" ILIKE ${searchPattern}
                OR COALESCE(o."tradeName", '') ILIKE ${searchPattern}
                OR COALESCE(p.summary, '') ILIKE ${searchPattern}
                OR p.city ILIKE ${searchPattern}
                OR p.state ILIKE ${searchPattern}
              )`
            : Prisma.empty
        }
      ORDER BY o.id ASC
      LIMIT ${query.limit + 1}
    `);
    const hasMore = rows.length > query.limit;
    const pageRows = rows.slice(0, query.limit);

    return {
      dealers: pageRows.map((dealer) => ({
        ...this.publicDealer(dealer),
        catalogue: { available: true as const },
      })),
      page: {
        nextCursor: hasMore ? (pageRows.at(-1)?.id ?? null) : null,
        hasMore,
      },
    };
  }

  async dealerDetail(sessionId: string, context: RequestContext, dealerId: string) {
    await this.authorizePharmacy(sessionId, context);
    return { dealer: this.publicDealer(await this.visibleDealer(dealerId)) };
  }

  async dealerCatalogue(
    sessionId: string,
    context: RequestContext,
    dealerId: string,
    query: {
      q?: string | undefined;
      category?: string | undefined;
      manufacturer?: string | undefined;
      dosageForm?: string | undefined;
      cursor?: string | undefined;
      limit: number;
    },
  ) {
    await this.authorizePharmacy(sessionId, context);
    const dealer = this.publicDealer(await this.visibleDealer(dealerId));
    const search = query.q?.trim();
    const records = await this.database.dealerCatalogueItem.findMany({
      where: {
        organizationId: dealerId,
        isAvailable: true,
        product: {
          isActive: true,
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: 'insensitive' as const } },
                  { genericName: { contains: search, mode: 'insensitive' as const } },
                  { manufacturer: { name: { contains: search, mode: 'insensitive' as const } } },
                ],
              }
            : {}),
          ...(query.category
            ? { category: { name: { equals: query.category, mode: 'insensitive' as const } } }
            : {}),
          ...(query.manufacturer
            ? {
                manufacturer: {
                  name: { equals: query.manufacturer, mode: 'insensitive' as const },
                },
              }
            : {}),
          ...(query.dosageForm
            ? { dosageForm: { equals: query.dosageForm, mode: 'insensitive' as const } }
            : {}),
        },
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
      include: { product: { include: { manufacturer: true, category: true } } },
    });
    const hasMore = records.length > query.limit;
    const pageRecords = records.slice(0, query.limit);
    const [categories, manufacturers, dosageForms] = await Promise.all([
      this.catalogueFilterValues(dealerId, 'category'),
      this.catalogueFilterValues(dealerId, 'manufacturer'),
      this.catalogueFilterValues(dealerId, 'dosageForm'),
    ]);
    return {
      dealer,
      products: pageRecords.map((record) => ({
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
      })),
      filters: { categories, manufacturers, dosageForms },
      page: { nextCursor: hasMore ? (pageRecords.at(-1)?.id ?? null) : null, hasMore },
    };
  }

  async dealerCatalogueListing(
    sessionId: string,
    context: RequestContext,
    dealerId: string,
    listingId: string,
  ) {
    await this.authorizePharmacy(sessionId, context);
    const dealer = this.publicDealer(await this.visibleDealer(dealerId));
    const record = await this.database.dealerCatalogueItem.findFirst({
      where: {
        id: listingId,
        organizationId: dealerId,
        isAvailable: true,
        product: { isActive: true },
      },
      include: { product: { include: { manufacturer: true, category: true } } },
    });
    if (!record) {
      throw new AppError(404, 'CATALOGUE_LISTING_NOT_FOUND', 'Catalogue listing was not found.');
    }
    return {
      dealer,
      product: {
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
        isAvailable: true as const,
      },
    };
  }

  private async catalogueFilterValues(
    dealerId: string,
    field: 'category' | 'manufacturer' | 'dosageForm',
  ): Promise<string[]> {
    const expression =
      field === 'category'
        ? Prisma.sql`c.name`
        : field === 'manufacturer'
          ? Prisma.sql`m.name`
          : Prisma.sql`p."dosageForm"`;
    const join =
      field === 'category'
        ? Prisma.sql`LEFT JOIN product_categories c ON c.id = p."categoryId"`
        : field === 'manufacturer'
          ? Prisma.sql`LEFT JOIN manufacturers m ON m.id = p."manufacturerId"`
          : Prisma.empty;
    const rows = await this.database.$queryRaw<Array<{ value: string }>>(Prisma.sql`
      SELECT DISTINCT ${expression} AS value
      FROM dealer_catalogue_items d
      INNER JOIN products p ON p.id = d."productId"
      ${join}
      WHERE d."organizationId" = ${dealerId}::uuid
        AND d."isAvailable" = TRUE
        AND p."isActive" = TRUE
        AND ${expression} IS NOT NULL
        AND ${expression} <> ''
      ORDER BY value ASC
    `);
    return rows.map((row) => row.value);
  }

  private async visibleDealer(dealerId: string) {
    const rows = await this.database.$queryRaw<DealerRow[]>(Prisma.sql`
      SELECT o.id, o."legalName", o."tradeName", p.summary, p.city, p.state, p."serviceAreas"
      FROM organizations o
      INNER JOIN dealer_public_profiles p ON p."organizationId" = o.id
      INNER JOIN LATERAL (
        SELECT k.status FROM kyc_records k
        WHERE k."organizationId" = o.id ORDER BY k.revision DESC LIMIT 1
      ) latest_kyc ON latest_kyc.status = 'VERIFIED'
      WHERE o.id = ${dealerId}::uuid AND o.type = 'DEALER' AND o.status = 'ACTIVE'
    `);
    const dealer = rows[0];
    if (!dealer) throw new AppError(404, 'DEALER_NOT_FOUND', 'Dealer was not found.');
    return dealer;
  }

  private publicDealer(dealer: DealerRow) {
    return {
      id: dealer.id,
      name: dealer.tradeName ?? dealer.legalName,
      verificationStatus: 'VERIFIED' as const,
      summary: dealer.summary,
      location: { city: dealer.city, state: dealer.state },
      serviceAreas: dealer.serviceAreas,
    };
  }

  private async authorizePharmacy(sessionId: string, context: RequestContext) {
    const authorizedSession = await this.database.session.findFirst({
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
          roles: { some: { role: { organizationType: 'PHARMACY' } } },
        },
        activeOrganization: { type: 'PHARMACY', status: 'ACTIVE' },
      },
      select: { id: true },
    });
    if (!authorizedSession) throw new AuthorizationError();
    requirePermission(context, PERMISSIONS.ORGANIZATION_READ);
  }
}
