import { randomBytes } from 'node:crypto';

import { PERMISSIONS } from '@ligimed/auth';
import { Prisma, type PrismaClient } from '@ligimed/database';
import type { RequestContext } from '@ligimed/types';
import {
  retailSaleInputSchema,
  type PurchaseInvoiceInput,
  type RetailDraftInput,
  type RetailSaleInput,
  type InvoicePaymentEntryInput,
} from '@ligimed/validation';

import { AppError } from '../../platform/errors.js';
import { authorizeActivePharmacy } from '../../platform/pharmacy-authorization.js';

type InvoiceQuery = {
  type?: 'RETAIL_SALE' | 'DEALER_PURCHASE' | undefined;
  cursor?: string | undefined;
  limit: number;
};

const invoiceInclude = {
  customer: { select: { displayName: true } },
  dealerOrganization: { select: { legalName: true, tradeName: true } },
  order: { select: { orderNumber: true, status: true, totalMinor: true, items: true } },
  lines: { orderBy: { id: 'asc' as const } },
  paymentEntries: { orderBy: { recordedAt: 'desc' as const } },
} as const;

type InvoiceRecord = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

const amount = (value: bigint, currency: string) => ({
  amountMinor: value.toString(),
  currency,
});

function indiaDate() {
  // The first supported market is India; a DATE-only expiry is evaluated in that market's day.
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

function reconciliation(invoice: InvoiceRecord) {
  if (invoice.type === 'RETAIL_SALE') return 'NOT_APPLICABLE' as const;
  if (invoice.order?.status !== 'DELIVERED') return 'PENDING_DELIVERY' as const;
  if (invoice.order.totalMinor !== invoice.totalMinor) return 'AMOUNT_MISMATCH' as const;
  return 'MATCHED' as const;
}

function summary(invoice: InvoiceRecord) {
  return {
    id: invoice.id,
    type: invoice.type,
    referenceNumber: invoice.referenceNumber,
    counterpartyName: invoice.counterpartyName,
    orderNumber: invoice.order?.orderNumber ?? null,
    total: amount(invoice.totalMinor, invoice.currency),
    reconciliation: reconciliation(invoice),
    recordedAt: invoice.recordedAt.toISOString(),
  };
}

function detail(invoice: InvoiceRecord) {
  const recordedNet = invoice.paymentEntries.reduce(
    (sum, entry) => sum + (entry.type === 'PAYMENT' ? entry.amountMinor : -entry.amountMinor),
    0n,
  );
  return {
    ...summary(invoice),
    subtotal: amount(invoice.subtotalMinor, invoice.currency),
    discount: amount(invoice.discountMinor, invoice.currency),
    tax: amount(invoice.taxMinor, invoice.currency),
    deliveryCharge: amount(invoice.deliveryChargeMinor, invoice.currency),
    issuedAt: invoice.externalIssuedAt?.toISOString().slice(0, 10) ?? null,
    lines: invoice.lines.map((line) => ({
      id: line.id,
      productName: line.productName,
      batchNumber: line.batchNumber,
      quantity: line.quantity,
      unitPrice: amount(line.unitPriceMinor, invoice.currency),
      subtotal: amount(line.subtotalMinor, invoice.currency),
      discount: amount(line.discountMinor, invoice.currency),
      tax: amount(line.taxMinor, invoice.currency),
      total: amount(line.lineTotalMinor, invoice.currency),
    })),
    orderItems: (invoice.order?.items ?? []).map((item) => ({
      productName: item.productName,
      quantity: item.quantity,
      lineTotal: amount(item.lineTotalMinor, invoice.currency),
    })),
    paymentLedger: {
      recordedNet: amount(recordedNet, invoice.currency),
      remaining: amount(invoice.totalMinor - recordedNet, invoice.currency),
      status:
        recordedNet === 0n
          ? ('UNPAID' as const)
          : recordedNet === invoice.totalMinor
            ? ('RECORDED_IN_FULL' as const)
            : ('PARTIAL' as const),
      entries: invoice.paymentEntries.map((entry) => ({
        id: entry.id,
        type: entry.type,
        method: entry.method,
        amount: amount(entry.amountMinor, entry.currency),
        reference: entry.reference,
        occurredAt: entry.occurredAt.toISOString(),
        recordedAt: entry.recordedAt.toISOString(),
      })),
    },
  };
}

function safeTotal(value: bigint) {
  if (value > 9_000_000_000_000_000_000n)
    throw new AppError(422, 'AMOUNT_TOO_LARGE', 'The bill amount is too large.');
  return value;
}

export class BillingService {
  constructor(private readonly database: PrismaClient) {}

  async options(
    sessionId: string,
    context: RequestContext,
    query: { kind: 'customers' | 'batches' | 'orders'; q?: string | undefined },
  ) {
    await authorizeActivePharmacy(this.database, sessionId, context, PERMISSIONS.BILLING_READ);
    const q = query.q?.trim();
    if (query.kind === 'customers') {
      const customers = await this.database.customer.findMany({
        where: {
          organizationId: context.organizationId,
          archivedAt: null,
          ...(q
            ? {
                OR: [
                  { displayName: { contains: q, mode: 'insensitive' as const } },
                  { phoneNumber: { contains: q } },
                  { email: { contains: q, mode: 'insensitive' as const } },
                ],
              }
            : {}),
        },
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        take: 30,
        select: { id: true, displayName: true, phoneNumber: true, email: true },
      });
      return {
        customers: customers.map((customer) => ({
          id: customer.id,
          name: customer.displayName,
          phoneNumber: customer.phoneNumber,
          email: customer.email,
        })),
        batches: [],
        orders: [],
      };
    }
    if (query.kind === 'batches') {
      const batches = await this.database.inventoryBatch.findMany({
        where: {
          inventoryItem: {
            organizationId: context.organizationId,
          },
          ...(q
            ? {
                OR: [
                  { batchNumber: { contains: q, mode: 'insensitive' as const } },
                  {
                    inventoryItem: {
                      product: {
                        OR: [
                          { name: { contains: q, mode: 'insensitive' as const } },
                          { genericName: { contains: q, mode: 'insensitive' as const } },
                          { manufacturer: { name: { contains: q, mode: 'insensitive' as const } } },
                          {
                            catalogueItems: {
                              some: { sku: { contains: q, mode: 'insensitive' as const } },
                            },
                          },
                        ],
                      },
                    },
                  },
                ],
              }
            : {}),
          quantityOnHand: { gt: 0 },
          expiresAt: { gte: new Date(`${indiaDate()}T00:00:00.000Z`) },
          currency: 'INR',
        },
        include: {
          inventoryItem: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  genericName: true,
                  packSize: true,
                  manufacturer: { select: { name: true } },
                },
              },
            },
          },
        },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        take: 30,
      });
      return {
        customers: [],
        batches: batches.map((batch) => ({
          id: batch.id,
          productId: batch.inventoryItem.product.id,
          name: batch.inventoryItem.product.name,
          genericName: batch.inventoryItem.product.genericName,
          manufacturerName: batch.inventoryItem.product.manufacturer?.name ?? null,
          packSize: batch.inventoryItem.product.packSize,
          batchNumber: batch.batchNumber,
          quantityOnHand: batch.quantityOnHand,
          expiresAt: batch.expiresAt.toISOString().slice(0, 10),
          reorderLevel: batch.inventoryItem.reorderLevel,
        })),
        orders: [],
      };
    }
    const orders = await this.database.order.findMany({
      where: {
        pharmacyOrganizationId: context.organizationId,
        status: {
          in: ['CONFIRMED', 'PREPARING', 'PACKED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED'],
        },
        purchaseInvoice: { is: null },
        ...(q
          ? {
              OR: [
                { orderNumber: { contains: q, mode: 'insensitive' as const } },
                {
                  dealerOrganization: { legalName: { contains: q, mode: 'insensitive' as const } },
                },
              ],
            }
          : {}),
      },
      include: { dealerOrganization: { select: { legalName: true, tradeName: true } } },
      orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
      take: 30,
    });
    return {
      customers: [],
      batches: [],
      orders: orders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        dealerName: order.dealerOrganization.tradeName ?? order.dealerOrganization.legalName,
        status: order.status,
        total: amount(order.totalMinor, order.currency),
      })),
    };
  }

  async list(sessionId: string, context: RequestContext, query: InvoiceQuery) {
    await authorizeActivePharmacy(this.database, sessionId, context, PERMISSIONS.BILLING_READ);
    if (query.cursor) {
      const cursor = await this.database.invoice.findFirst({
        where: {
          id: query.cursor,
          pharmacyOrganizationId: context.organizationId,
          ...(query.type ? { type: query.type } : {}),
        },
        select: { id: true },
      });
      if (!cursor) throw new AppError(400, 'INVALID_CURSOR', 'The page cursor is invalid.');
    }
    const rows = await this.database.invoice.findMany({
      where: {
        pharmacyOrganizationId: context.organizationId,
        ...(query.type ? { type: query.type } : {}),
      },
      include: invoiceInclude,
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      invoices: page.map(summary),
      page: {
        hasMore: rows.length > query.limit,
        nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      },
    };
  }

  async get(sessionId: string, context: RequestContext, id: string) {
    await authorizeActivePharmacy(this.database, sessionId, context, PERMISSIONS.BILLING_READ);
    const invoice = await this.database.invoice.findFirst({
      where: { id, pharmacyOrganizationId: context.organizationId },
      include: invoiceInclude,
    });
    if (!invoice) throw new AppError(404, 'INVOICE_NOT_FOUND', 'Billing record not found.');
    return detail(invoice);
  }

  async recordPaymentEntry(
    sessionId: string,
    context: RequestContext,
    invoiceId: string,
    input: InvoicePaymentEntryInput,
  ) {
    const occurredAt = new Date(input.occurredAt);
    if (occurredAt.getTime() > Date.now() + 60_000)
      throw new AppError(
        422,
        'PAYMENT_DATE_IN_FUTURE',
        'The payment date cannot be in the future.',
      );
    await this.database.$transaction(async (tx) => {
      await authorizeActivePharmacy(tx, sessionId, context, PERMISSIONS.BILLING_MANAGE);
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM invoices WHERE id = ${invoiceId}::uuid
          AND "pharmacyOrganizationId" = ${context.organizationId}::uuid
        FOR UPDATE
      `;
      if (!locked.length) throw new AppError(404, 'INVOICE_NOT_FOUND', 'Billing record not found.');
      const invoice = await tx.invoice.findFirstOrThrow({
        where: { id: invoiceId, pharmacyOrganizationId: context.organizationId },
        select: { totalMinor: true, currency: true },
      });
      const existing = await tx.invoicePaymentEntry.findUnique({
        where: { invoiceId_idempotencyKey: { invoiceId, idempotencyKey: input.idempotencyKey } },
      });
      if (existing) {
        if (
          existing.type !== input.type ||
          existing.method !== input.method ||
          existing.amountMinor !== BigInt(input.amountMinor) ||
          existing.reference !== input.reference ||
          existing.occurredAt.getTime() !== occurredAt.getTime()
        )
          throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'This request key was already used.');
        return;
      }
      const entries = await tx.invoicePaymentEntry.findMany({
        where: { invoiceId },
        select: { type: true, amountMinor: true },
      });
      const recordedNet = entries.reduce(
        (sum, entry) => sum + (entry.type === 'PAYMENT' ? entry.amountMinor : -entry.amountMinor),
        0n,
      );
      const entryAmount = BigInt(input.amountMinor);
      if (input.type === 'PAYMENT' && recordedNet + entryAmount > invoice.totalMinor)
        throw new AppError(422, 'PAYMENT_EXCEEDS_BALANCE', 'Amount exceeds the remaining balance.');
      if (input.type === 'REFUND' && entryAmount > recordedNet)
        throw new AppError(422, 'REFUND_EXCEEDS_PAYMENTS', 'Refund exceeds recorded payments.');
      const entry = await tx.invoicePaymentEntry.create({
        data: {
          invoiceId,
          idempotencyKey: input.idempotencyKey,
          type: input.type,
          method: input.method,
          amountMinor: entryAmount,
          currency: invoice.currency,
          reference: input.reference,
          occurredAt,
          recordedById: context.userId,
        },
      });
      await tx.auditLog.create({
        data: {
          requestId: context.requestId,
          actorUserId: context.userId,
          organizationId: context.organizationId,
          action: `billing.${input.type.toLowerCase()}_entry_recorded`,
          resourceType: 'invoice_payment_entry',
          resourceId: entry.id,
          outcome: 'SUCCESS',
          details: { invoiceId, method: input.method, amountMinor: input.amountMinor },
        },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'invoice',
          aggregateId: invoiceId,
          eventType: `billing.${input.type.toLowerCase()}_entry_recorded`,
          payload: { invoiceId, entryId: entry.id, organizationId: context.organizationId },
        },
      });
    });
    return this.get(sessionId, context, invoiceId);
  }

  private draftSummary(draft: {
    id: string;
    customer: { displayName: string } | null;
    lines: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const parsed = retailSaleInputSchema.shape.lines.parse(draft.lines);
    const total = parsed.reduce(
      (sum, line) =>
        sum +
        BigInt(line.unitPriceMinor) * BigInt(line.quantity) -
        BigInt(line.discountMinor) +
        BigInt(line.taxMinor),
      0n,
    );
    return {
      id: draft.id,
      customerName: draft.customer?.displayName ?? null,
      itemCount: parsed.reduce((sum, line) => sum + line.quantity, 0),
      total: amount(total, 'INR'),
      createdAt: draft.createdAt.toISOString(),
      updatedAt: draft.updatedAt.toISOString(),
    };
  }

  async listDrafts(sessionId: string, context: RequestContext) {
    await authorizeActivePharmacy(this.database, sessionId, context, PERMISSIONS.BILLING_READ);
    const drafts = await this.database.retailBillDraft.findMany({
      where: { organizationId: context.organizationId },
      include: { customer: { select: { displayName: true } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 30,
    });
    return { drafts: drafts.map((draft) => this.draftSummary(draft)) };
  }

  async getDraft(sessionId: string, context: RequestContext, id: string) {
    await authorizeActivePharmacy(this.database, sessionId, context, PERMISSIONS.BILLING_READ);
    const draft = await this.database.retailBillDraft.findFirst({
      where: { id, organizationId: context.organizationId },
      include: { customer: { select: { displayName: true } } },
    });
    if (!draft) throw new AppError(404, 'DRAFT_NOT_FOUND', 'Bill draft not found.');
    const lines = retailSaleInputSchema.shape.lines.parse(draft.lines);
    const batches = await this.database.inventoryBatch.findMany({
      where: {
        id: { in: lines.map((line) => line.batchId) },
        inventoryItem: { organizationId: context.organizationId },
      },
      include: { inventoryItem: { include: { product: { include: { manufacturer: true } } } } },
    });
    return {
      ...this.draftSummary(draft),
      customerId: draft.customerId,
      lines: lines.map((line) => {
        const batch = batches.find((item) => item.id === line.batchId);
        return {
          ...line,
          batch: batch
            ? {
                id: batch.id,
                productId: batch.inventoryItem.product.id,
                name: batch.inventoryItem.product.name,
                genericName: batch.inventoryItem.product.genericName,
                manufacturerName: batch.inventoryItem.product.manufacturer?.name ?? null,
                packSize: batch.inventoryItem.product.packSize,
                batchNumber: batch.batchNumber,
                quantityOnHand: batch.quantityOnHand,
                expiresAt: batch.expiresAt.toISOString().slice(0, 10),
                reorderLevel: batch.inventoryItem.reorderLevel,
              }
            : null,
        };
      }),
    };
  }

  async saveDraft(
    sessionId: string,
    context: RequestContext,
    input: RetailDraftInput,
    id?: string,
  ) {
    await authorizeActivePharmacy(this.database, sessionId, context, PERMISSIONS.BILLING_MANAGE);
    if (input.customerId) {
      const customer = await this.database.customer.findFirst({
        where: { id: input.customerId, organizationId: context.organizationId, archivedAt: null },
        select: { id: true },
      });
      if (!customer) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Select an active customer.');
    }
    const batchCount = await this.database.inventoryBatch.count({
      where: {
        id: { in: input.lines.map((line) => line.batchId) },
        inventoryItem: { organizationId: context.organizationId },
      },
    });
    if (batchCount !== input.lines.length)
      throw new AppError(404, 'BATCH_NOT_FOUND', 'A selected stock batch was not found.');
    const lines = input.lines as Prisma.InputJsonValue;
    const result = await this.database.$transaction(async (tx) => {
      await authorizeActivePharmacy(tx, sessionId, context, PERMISSIONS.BILLING_MANAGE);
      if (id) {
        const updated = await tx.retailBillDraft.updateMany({
          where: { id, organizationId: context.organizationId },
          data: { customerId: input.customerId, lines, updatedById: context.userId },
        });
        if (!updated.count) throw new AppError(404, 'DRAFT_NOT_FOUND', 'Bill draft not found.');
      }
      const draft = id
        ? { id }
        : await tx.retailBillDraft.create({
            data: {
              organizationId: context.organizationId,
              customerId: input.customerId,
              lines,
              createdById: context.userId,
              updatedById: context.userId,
            },
            select: { id: true },
          });
      await tx.auditLog.create({
        data: {
          requestId: context.requestId,
          actorUserId: context.userId,
          organizationId: context.organizationId,
          action: id ? 'billing.draft_updated' : 'billing.draft_created',
          resourceType: 'retail_bill_draft',
          resourceId: draft.id,
          outcome: 'SUCCESS',
          details: { lineCount: input.lines.length },
        },
      });
      return draft.id;
    });
    return this.getDraft(sessionId, context, result);
  }

  async deleteDraft(sessionId: string, context: RequestContext, id: string) {
    await this.database.$transaction(async (tx) => {
      await authorizeActivePharmacy(tx, sessionId, context, PERMISSIONS.BILLING_MANAGE);
      const deleted = await tx.retailBillDraft.deleteMany({
        where: { id, organizationId: context.organizationId },
      });
      if (!deleted.count) throw new AppError(404, 'DRAFT_NOT_FOUND', 'Bill draft not found.');
      await tx.auditLog.create({
        data: {
          requestId: context.requestId,
          actorUserId: context.userId,
          organizationId: context.organizationId,
          action: 'billing.draft_deleted',
          resourceType: 'retail_bill_draft',
          resourceId: id,
          outcome: 'SUCCESS',
          details: {},
        },
      });
    });
  }

  async customerHistory(sessionId: string, context: RequestContext, customerId: string) {
    await authorizeActivePharmacy(this.database, sessionId, context, PERMISSIONS.BILLING_READ);
    const customer = await this.database.customer.findFirst({
      where: { id: customerId, organizationId: context.organizationId },
      select: { id: true },
    });
    if (!customer) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found.');
    const where = {
      pharmacyOrganizationId: context.organizationId,
      customerId,
      type: 'RETAIL_SALE' as const,
    };
    const [purchaseCount, recent] = await Promise.all([
      this.database.invoice.count({ where }),
      this.database.invoice.findMany({
        where,
        include: { lines: { select: { productName: true } } },
        orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
        take: 3,
      }),
    ]);
    return {
      purchaseCount,
      recent: recent.map((invoice) => ({
        id: invoice.id,
        recordedAt: invoice.recordedAt.toISOString(),
        productNames: invoice.lines.map((line) => line.productName),
        total: amount(invoice.totalMinor, invoice.currency),
      })),
    };
  }

  async recordRetailSale(sessionId: string, context: RequestContext, input: RetailSaleInput) {
    // A retry must return the original record rather than deduct stock twice.
    await authorizeActivePharmacy(this.database, sessionId, context, PERMISSIONS.BILLING_MANAGE);
    const previous = await this.database.invoice.findFirst({
      where: {
        idempotencyKey: input.idempotencyKey,
        pharmacyOrganizationId: context.organizationId,
      },
      select: { id: true },
    });
    if (previous) return this.get(sessionId, context, previous.id);
    const invoiceId = await this.database
      .$transaction(async (tx) => {
        await authorizeActivePharmacy(tx, sessionId, context, PERMISSIONS.BILLING_MANAGE);
        if (input.draftId) {
          const draft = await tx.retailBillDraft.findFirst({
            where: { id: input.draftId, organizationId: context.organizationId },
            select: { id: true },
          });
          if (!draft) throw new AppError(404, 'DRAFT_NOT_FOUND', 'Bill draft not found.');
        }
        const customers = await tx.$queryRaw<Array<{ id: string; displayName: string }>>`
        SELECT id, "displayName" FROM customers WHERE id = ${input.customerId}::uuid
          AND "organizationId" = ${context.organizationId}::uuid AND "archivedAt" IS NULL
        FOR SHARE
      `;
        if (!customers.length)
          throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Select an active customer.');

        const prepared = [] as Array<{
          batchId: string;
          productName: string;
          batchNumber: string;
          quantity: number;
          balanceAfter: number;
          unitPriceMinor: bigint;
          subtotalMinor: bigint;
          discountMinor: bigint;
          taxMinor: bigint;
        }>;
        for (const line of [...input.lines].sort((a, b) => a.batchId.localeCompare(b.batchId))) {
          const rows = await tx.$queryRaw<
            Array<{
              id: string;
              batchNumber: string;
              quantityOnHand: number;
              expiresAt: Date;
              currency: string;
              productName: string;
            }>
          >`
          SELECT b.id, b."batchNumber", b."quantityOnHand", b."expiresAt", b.currency,
                 p.name AS "productName"
          FROM inventory_batches b
          JOIN inventory_items i ON i.id = b."inventoryItemId"
          JOIN products p ON p.id = i."productId"
          WHERE b.id = ${line.batchId}::uuid AND i."organizationId" = ${context.organizationId}::uuid
            AND p."isActive" = true
          FOR UPDATE OF b
        `;
          const batch = rows[0];
          if (!batch)
            throw new AppError(404, 'BATCH_NOT_FOUND', 'A selected stock batch was not found.');
          if (batch.currency !== 'INR')
            throw new AppError(422, 'CURRENCY_MISMATCH', 'Only INR stock can be billed here.');
          if (batch.expiresAt.toISOString().slice(0, 10) < indiaDate())
            throw new AppError(422, 'BATCH_EXPIRED', 'Expired stock cannot be sold.');
          if (batch.quantityOnHand < line.quantity)
            throw new AppError(
              409,
              'INSUFFICIENT_STOCK',
              'Stock changed. Review the available quantity.',
            );
          const unitPriceMinor = BigInt(line.unitPriceMinor);
          const discountMinor = BigInt(line.discountMinor);
          const taxMinor = BigInt(line.taxMinor);
          const subtotalMinor = safeTotal(unitPriceMinor * BigInt(line.quantity));
          if (discountMinor > subtotalMinor)
            throw new AppError(
              422,
              'DISCOUNT_AMOUNT_INVALID',
              'Line discount exceeds its subtotal.',
            );
          if (taxMinor > subtotalMinor)
            throw new AppError(
              422,
              'TAX_AMOUNT_INVALID',
              'Line tax cannot exceed the line subtotal.',
            );
          prepared.push({
            batchId: batch.id,
            productName: batch.productName,
            batchNumber: batch.batchNumber,
            quantity: line.quantity,
            balanceAfter: batch.quantityOnHand - line.quantity,
            unitPriceMinor,
            subtotalMinor,
            discountMinor,
            taxMinor,
          });
        }
        const subtotalMinor = safeTotal(prepared.reduce((sum, row) => sum + row.subtotalMinor, 0n));
        const discountMinor = safeTotal(prepared.reduce((sum, row) => sum + row.discountMinor, 0n));
        const taxMinor = safeTotal(prepared.reduce((sum, row) => sum + row.taxMinor, 0n));
        const invoice = await tx.invoice.create({
          data: {
            pharmacyOrganizationId: context.organizationId,
            type: 'RETAIL_SALE',
            // Internal reference only; statutory numbering awaits tax/compliance validation.
            referenceNumber: `LM-SALE-${randomBytes(10).toString('hex').toUpperCase()}`,
            idempotencyKey: input.idempotencyKey,
            counterpartyName: customers[0]!.displayName,
            customerId: input.customerId,
            subtotalMinor,
            discountMinor,
            taxMinor,
            totalMinor: safeTotal(subtotalMinor - discountMinor + taxMinor),
            recordedById: context.userId,
          },
        });
        for (const line of prepared) {
          await tx.inventoryBatch.update({
            where: { id: line.batchId },
            data: { quantityOnHand: line.balanceAfter },
          });
          const movement = await tx.stockMovement.create({
            data: {
              inventoryBatchId: line.batchId,
              type: 'SALE',
              quantityDelta: -line.quantity,
              balanceAfter: line.balanceAfter,
              reason: `Retail sale ${invoice.referenceNumber}`,
              createdById: context.userId,
            },
          });
          await tx.invoiceLine.create({
            data: {
              invoiceId: invoice.id,
              inventoryBatchId: line.batchId,
              stockMovementId: movement.id,
              productName: line.productName,
              batchNumber: line.batchNumber,
              quantity: line.quantity,
              unitPriceMinor: line.unitPriceMinor,
              subtotalMinor: line.subtotalMinor,
              discountMinor: line.discountMinor,
              taxMinor: line.taxMinor,
              lineTotalMinor: line.subtotalMinor - line.discountMinor + line.taxMinor,
            },
          });
        }
        await tx.auditLog.create({
          data: {
            requestId: context.requestId,
            actorUserId: context.userId,
            organizationId: context.organizationId,
            action: 'billing.retail_sale_recorded',
            resourceType: 'invoice',
            resourceId: invoice.id,
            outcome: 'SUCCESS',
            details: { customerId: input.customerId, lineCount: prepared.length },
          },
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: 'invoice',
            aggregateId: invoice.id,
            eventType: 'billing.retail_sale_recorded',
            payload: { invoiceId: invoice.id, organizationId: context.organizationId },
          },
        });
        if (input.draftId)
          await tx.retailBillDraft.deleteMany({
            where: { id: input.draftId, organizationId: context.organizationId },
          });
        return invoice.id;
      })
      .catch(async (error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const existing = await this.database.invoice.findFirst({
            where: {
              idempotencyKey: input.idempotencyKey,
              pharmacyOrganizationId: context.organizationId,
            },
            select: { id: true },
          });
          if (existing) return existing.id;
        }
        throw error;
      });
    return this.get(sessionId, context, invoiceId);
  }

  async recordPurchase(sessionId: string, context: RequestContext, input: PurchaseInvoiceInput) {
    const invoiceId = await this.database
      .$transaction(async (tx) => {
        await authorizeActivePharmacy(tx, sessionId, context, PERMISSIONS.BILLING_MANAGE);
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM orders WHERE id = ${input.orderId}::uuid
          AND "pharmacyOrganizationId" = ${context.organizationId}::uuid
        FOR SHARE
      `;
        if (!locked.length) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
        const order = await tx.order.findFirstOrThrow({
          where: { id: input.orderId, pharmacyOrganizationId: context.organizationId },
          select: {
            id: true,
            status: true,
            dealerOrganizationId: true,
            currency: true,
            dealerOrganization: { select: { legalName: true } },
          },
        });
        if (['PENDING', 'CANCELLED', 'REJECTED', 'RETURNED'].includes(order.status))
          throw new AppError(
            409,
            'ORDER_NOT_ELIGIBLE',
            'The dealer order is not eligible for invoice recording.',
          );
        if (order.currency !== 'INR')
          throw new AppError(422, 'CURRENCY_MISMATCH', 'Only INR purchase invoices are supported.');
        const issuedAt = new Date(`${input.issuedAt}T00:00:00.000Z`);
        if (issuedAt.getTime() > Date.now())
          throw new AppError(422, 'FUTURE_ISSUE_DATE', 'Issue date cannot be in the future.');
        const subtotalMinor = BigInt(input.subtotalMinor);
        const taxMinor = BigInt(input.taxMinor);
        const deliveryChargeMinor = BigInt(input.deliveryChargeMinor);
        const invoice = await tx.invoice.create({
          data: {
            pharmacyOrganizationId: context.organizationId,
            type: 'DEALER_PURCHASE',
            referenceNumber: input.referenceNumber,
            counterpartyName: order.dealerOrganization.legalName,
            dealerOrganizationId: order.dealerOrganizationId,
            orderId: order.id,
            externalIssuedAt: issuedAt,
            subtotalMinor,
            taxMinor,
            deliveryChargeMinor,
            totalMinor: safeTotal(subtotalMinor + taxMinor + deliveryChargeMinor),
            recordedById: context.userId,
          },
        });
        await tx.auditLog.create({
          data: {
            requestId: context.requestId,
            actorUserId: context.userId,
            organizationId: context.organizationId,
            action: 'billing.dealer_purchase_recorded',
            resourceType: 'invoice',
            resourceId: invoice.id,
            outcome: 'SUCCESS',
            details: { orderId: order.id, dealerOrganizationId: order.dealerOrganizationId },
          },
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: 'invoice',
            aggregateId: invoice.id,
            eventType: 'billing.dealer_purchase_recorded',
            payload: { invoiceId: invoice.id, organizationId: context.organizationId },
          },
        });
        return invoice.id;
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new AppError(
            409,
            'INVOICE_ALREADY_RECORDED',
            'This invoice or order is already recorded.',
          );
        }
        throw error;
      });
    return this.get(sessionId, context, invoiceId);
  }
}
