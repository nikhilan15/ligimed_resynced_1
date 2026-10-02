import { AuthorizationError, PERMISSIONS, requirePermission } from '@ligimed/auth';
import { Prisma, type PrismaClient } from '@ligimed/database';
import type { RequestContext } from '@ligimed/types';
import type { InventoryAdjustmentInput, InventoryBatchInput } from '@ligimed/validation';

import { AppError } from '../../platform/errors.js';

interface InventoryQuery {
  q?: string | undefined;
  status: 'ALL' | 'LOW_STOCK' | 'NEAR_EXPIRY' | 'EXPIRED';
  cursor?: string | undefined;
  limit: number;
}

const productSelect = {
  id: true,
  name: true,
  genericName: true,
  strength: true,
  dosageForm: true,
  packSize: true,
} as const;

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

export class InventoryService {
  constructor(private readonly database: PrismaClient) {}

  async products(sessionId: string, context: RequestContext, q: string | undefined, limit: number) {
    await this.authorize(sessionId, context, PERMISSIONS.INVENTORY_READ);
    return {
      products: await this.database.product.findMany({
        where: {
          isActive: true,
          ...(q
            ? {
                OR: [
                  { name: { contains: q, mode: 'insensitive' as const } },
                  { genericName: { contains: q, mode: 'insensitive' as const } },
                ],
              }
            : {}),
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: limit,
        select: productSelect,
      }),
    };
  }

  async list(sessionId: string, context: RequestContext, query: InventoryQuery) {
    await this.authorize(sessionId, context, PERMISSIONS.INVENTORY_READ);
    const records = await this.database.inventoryItem.findMany({
      where: {
        organizationId: context.organizationId,
        ...(query.q
          ? {
              product: {
                OR: [
                  { name: { contains: query.q, mode: 'insensitive' as const } },
                  { genericName: { contains: query.q, mode: 'insensitive' as const } },
                  { strength: { contains: query.q, mode: 'insensitive' as const } },
                ],
              },
            }
          : {}),
        ...(query.status === 'NEAR_EXPIRY'
          ? {
              batches: {
                some: {
                  quantityOnHand: { gt: 0 },
                  expiresAt: {
                    gte: new Date(),
                    lte: new Date(Date.now() + 90 * 86_400_000),
                  },
                },
              },
            }
          : {}),
        ...(query.status === 'EXPIRED'
          ? { batches: { some: { quantityOnHand: { gt: 0 }, expiresAt: { lt: new Date() } } } }
          : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.status === 'LOW_STOCK' ? 200 : query.limit + 1,
      include: {
        product: { select: productSelect },
        batches: { orderBy: [{ expiresAt: 'asc' }, { batchNumber: 'asc' }] },
      },
    });
    const mapped = records.map((record) => this.publicItem(record));
    const filtered =
      query.status === 'LOW_STOCK' ? mapped.filter((record) => record.lowStock) : mapped;
    const page = filtered.slice(0, query.limit);
    const hasMore = filtered.length > query.limit;
    return {
      summary: await this.summary(context.organizationId),
      items: page,
      page: { nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null, hasMore },
    };
  }

  async addBatch(sessionId: string, context: RequestContext, input: InventoryBatchInput) {
    await this.authorize(sessionId, context, PERMISSIONS.INVENTORY_MANAGE);
    await this.database.$transaction(async (transaction) => {
      const product = await transaction.product.findFirst({
        where: { id: input.productId, isActive: true },
        select: { id: true },
      });
      if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Medicine was not found.');
      const item = await transaction.inventoryItem.upsert({
        where: {
          organizationId_productId: {
            organizationId: context.organizationId,
            productId: input.productId,
          },
        },
        create: {
          organizationId: context.organizationId,
          productId: input.productId,
          reorderLevel: input.reorderLevel,
        },
        update: { reorderLevel: input.reorderLevel },
      });
      const duplicate = await transaction.inventoryBatch.findUnique({
        where: {
          inventoryItemId_batchNumber: {
            inventoryItemId: item.id,
            batchNumber: input.batchNumber,
          },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new AppError(409, 'BATCH_ALREADY_EXISTS', 'This batch number already exists.');
      }
      const batch = await transaction.inventoryBatch.create({
        data: {
          inventoryItemId: item.id,
          batchNumber: input.batchNumber,
          quantityOnHand: input.quantity,
          purchasePriceMinor:
            input.purchasePriceMinor === null ? null : BigInt(input.purchasePriceMinor),
          manufacturedAt: input.manufacturedAt
            ? new Date(`${input.manufacturedAt}T00:00:00.000Z`)
            : null,
          expiresAt: new Date(`${input.expiresAt}T00:00:00.000Z`),
          movements: {
            create: {
              type: 'RECEIPT',
              quantityDelta: input.quantity,
              balanceAfter: input.quantity,
              reason: 'Initial batch receipt',
              createdById: context.userId,
            },
          },
        },
      });
      await transaction.auditLog.create({
        data: {
          requestId: context.requestId,
          actorUserId: context.userId,
          organizationId: context.organizationId,
          action: 'inventory.batch_received',
          resourceType: 'inventory_batch',
          resourceId: batch.id,
          outcome: 'SUCCESS',
          details: {
            productId: input.productId,
            batchNumber: input.batchNumber,
            quantity: input.quantity,
          },
        },
      });
      await transaction.outboxEvent.create({
        data: {
          aggregateType: 'inventory_batch',
          aggregateId: batch.id,
          eventType: 'inventory.batch_received',
          payload: {
            organizationId: context.organizationId,
            productId: input.productId,
            quantity: input.quantity,
          },
        },
      });
    });
    return { created: true };
  }

  async adjustBatch(
    sessionId: string,
    context: RequestContext,
    batchId: string,
    input: InventoryAdjustmentInput,
  ) {
    await this.authorize(sessionId, context, PERMISSIONS.INVENTORY_MANAGE);
    return this.database.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<
        Array<{ id: string; quantityOnHand: number }>
      >(Prisma.sql`
        SELECT b.id, b."quantityOnHand"
        FROM inventory_batches b
        JOIN inventory_items i ON i.id = b."inventoryItemId"
        WHERE b.id = ${batchId}::uuid AND i."organizationId" = ${context.organizationId}::uuid
        FOR UPDATE
      `);
      const batch = locked[0];
      if (!batch) throw new AppError(404, 'INVENTORY_BATCH_NOT_FOUND', 'Batch was not found.');
      const delta = input.direction === 'IN' ? input.quantity : -input.quantity;
      const balanceAfter = batch.quantityOnHand + delta;
      if (balanceAfter < 0) {
        throw new AppError(409, 'INSUFFICIENT_STOCK', 'Adjustment cannot make stock negative.');
      }
      await transaction.inventoryBatch.update({
        where: { id: batch.id },
        data: {
          quantityOnHand: balanceAfter,
          movements: {
            create: {
              type: input.direction === 'IN' ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
              quantityDelta: delta,
              balanceAfter,
              reason: input.reason,
              createdById: context.userId,
            },
          },
        },
      });
      await transaction.auditLog.create({
        data: {
          requestId: context.requestId,
          actorUserId: context.userId,
          organizationId: context.organizationId,
          action: 'inventory.stock_adjusted',
          resourceType: 'inventory_batch',
          resourceId: batch.id,
          outcome: 'SUCCESS',
          details: { delta, balanceAfter, reason: input.reason },
        },
      });
      return { batchId: batch.id, quantityOnHand: balanceAfter };
    });
  }

  async threshold(
    sessionId: string,
    context: RequestContext,
    itemId: string,
    reorderLevel: number,
  ) {
    await this.authorize(sessionId, context, PERMISSIONS.INVENTORY_MANAGE);
    const result = await this.database.inventoryItem.updateMany({
      where: { id: itemId, organizationId: context.organizationId },
      data: { reorderLevel },
    });
    if (result.count === 0)
      throw new AppError(404, 'INVENTORY_ITEM_NOT_FOUND', 'Inventory item was not found.');
    return { itemId, reorderLevel };
  }

  private publicItem(record: {
    id: string;
    reorderLevel: number;
    product: {
      id: string;
      name: string;
      genericName: string | null;
      strength: string | null;
      dosageForm: string | null;
      packSize: string | null;
    };
    batches: Array<{
      id: string;
      batchNumber: string;
      quantityOnHand: number;
      purchasePriceMinor: bigint | null;
      currency: string;
      manufacturedAt: Date | null;
      expiresAt: Date;
      receivedAt: Date;
    }>;
  }) {
    const now = new Date();
    const near = new Date(now.getTime() + 90 * 86_400_000);
    const activeBatches = record.batches.filter((batch) => batch.quantityOnHand > 0);
    const quantityOnHand = activeBatches.reduce((sum, batch) => sum + batch.quantityOnHand, 0);
    const value = activeBatches.reduce(
      (sum, batch) => sum + (batch.purchasePriceMinor ?? 0n) * BigInt(batch.quantityOnHand),
      0n,
    );
    const expiredUnits = activeBatches
      .filter((batch) => batch.expiresAt < now)
      .reduce((sum, batch) => sum + batch.quantityOnHand, 0);
    return {
      id: record.id,
      product: record.product,
      quantityOnHand,
      reorderLevel: record.reorderLevel,
      lowStock: quantityOnHand <= record.reorderLevel,
      nearestExpiry: activeBatches[0] ? dateOnly(activeBatches[0].expiresAt) : null,
      nearExpiry: activeBatches.some((batch) => batch.expiresAt >= now && batch.expiresAt <= near),
      expiredUnits,
      value: { amountMinor: value.toString(), currency: 'INR' },
      batches: record.batches.map((batch) => ({
        id: batch.id,
        batchNumber: batch.batchNumber,
        quantityOnHand: batch.quantityOnHand,
        purchasePrice:
          batch.purchasePriceMinor === null
            ? null
            : { amountMinor: batch.purchasePriceMinor.toString(), currency: batch.currency },
        manufacturedAt: batch.manufacturedAt ? dateOnly(batch.manufacturedAt) : null,
        expiresAt: dateOnly(batch.expiresAt),
        receivedAt: batch.receivedAt.toISOString(),
      })),
    };
  }

  private async summary(organizationId: string) {
    const rows = await this.database.$queryRaw<
      Array<{
        products: bigint;
        units: bigint;
        lowStock: bigint;
        nearExpiry: bigint;
        expired: bigint;
        inventoryValue: bigint;
      }>
    >(Prisma.sql`
      WITH totals AS (
        SELECT i.id, i."reorderLevel",
          COALESCE(SUM(b."quantityOnHand"), 0)::bigint AS units,
          COALESCE(SUM(CASE WHEN b."purchasePriceMinor" IS NOT NULL THEN b."purchasePriceMinor" * b."quantityOnHand" ELSE 0 END), 0)::bigint AS value,
          BOOL_OR(b."quantityOnHand" > 0 AND b."expiresAt" < CURRENT_DATE) AS expired,
          BOOL_OR(b."quantityOnHand" > 0 AND b."expiresAt" BETWEEN CURRENT_DATE AND CURRENT_DATE + 90) AS near_expiry
        FROM inventory_items i LEFT JOIN inventory_batches b ON b."inventoryItemId" = i.id
        WHERE i."organizationId" = ${organizationId}::uuid GROUP BY i.id
      )
      SELECT COUNT(*)::bigint AS products, COALESCE(SUM(units), 0)::bigint AS units,
        COUNT(*) FILTER (WHERE units <= "reorderLevel")::bigint AS "lowStock",
        COUNT(*) FILTER (WHERE near_expiry)::bigint AS "nearExpiry",
        COUNT(*) FILTER (WHERE expired)::bigint AS expired,
        COALESCE(SUM(value), 0)::bigint AS "inventoryValue" FROM totals
    `);
    const row = rows[0] ?? {
      products: 0n,
      units: 0n,
      lowStock: 0n,
      nearExpiry: 0n,
      expired: 0n,
      inventoryValue: 0n,
    };
    return {
      products: Number(row.products),
      units: Number(row.units),
      lowStock: Number(row.lowStock),
      nearExpiry: Number(row.nearExpiry),
      expired: Number(row.expired),
      inventoryValue: { amountMinor: row.inventoryValue.toString(), currency: 'INR' },
    };
  }

  private async authorize(
    sessionId: string,
    context: RequestContext,
    permission: Parameters<typeof requirePermission>[1],
  ) {
    requirePermission(context, permission);
    const session = await this.database.session.findFirst({
      where: {
        id: sessionId,
        userId: context.userId,
        membershipId: context.membershipId,
        activeOrganizationId: context.organizationId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        scope: 'FULL',
        membership: { status: 'ACTIVE', organizationId: context.organizationId },
        activeOrganization: { type: 'PHARMACY', status: 'ACTIVE' },
      },
      select: { id: true },
    });
    if (!session) throw new AuthorizationError();
  }
}
