import { randomBytes } from 'node:crypto';

import { AuthorizationError, PERMISSIONS, requirePermission } from '@ligimed/auth';
import { Prisma, type PrismaClient } from '@ligimed/database';
import type { RequestContext } from '@ligimed/types';
import type {
  DealerOrderStatusInput,
  OrderStatusValue,
  PharmacyCheckoutInput,
} from '@ligimed/validation';

import { AppError } from '../../platform/errors.js';

interface OrderQuery {
  status?: OrderStatusValue | undefined;
  cursor?: string | undefined;
  limit: number;
}

const dealerTransitions: Record<OrderStatusValue, readonly OrderStatusValue[]> = {
  PENDING: ['CONFIRMED', 'REJECTED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['PACKED', 'CANCELLED'],
  PACKED: ['DISPATCHED'],
  DISPATCHED: ['IN_TRANSIT'],
  IN_TRANSIT: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
  REJECTED: [],
  RETURN_REQUESTED: ['RETURNED'],
  RETURNED: [],
};

const orderInclude = {
  pharmacyOrganization: { select: { id: true, legalName: true, tradeName: true } },
  dealerOrganization: { select: { id: true, legalName: true, tradeName: true } },
  items: true,
  statusHistory: { orderBy: { createdAt: 'asc' as const } },
} as const;

function organizationName(value: { legalName: string; tradeName: string | null }) {
  return value.tradeName ?? value.legalName;
}

function orderNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `LM-${date}-${randomBytes(5).toString('hex').toUpperCase()}`;
}

export class CommerceService {
  constructor(private readonly database: PrismaClient) {}

  async cart(sessionId: string, context: RequestContext) {
    await this.authorizePharmacy(sessionId, context, PERMISSIONS.ORDER_READ);
    const cart = await this.database.cart.findUnique({
      where: { pharmacyOrganizationId: context.organizationId },
      include: {
        dealerOrganization: { select: { id: true, legalName: true, tradeName: true } },
        items: {
          orderBy: { createdAt: 'asc' },
          include: { catalogueItem: { include: { product: true } } },
        },
      },
    });
    return { cart: cart ? this.publicCart(cart) : null };
  }

  async setCartItem(
    sessionId: string,
    context: RequestContext,
    listingId: string,
    quantity: number,
  ) {
    await this.authorizePharmacy(sessionId, context, PERMISSIONS.ORDER_CREATE);
    await this.database.$transaction(async (transaction) => {
      await this.lockOrganization(transaction, context.organizationId, 'PHARMACY');
      const listing = await transaction.dealerCatalogueItem.findFirst({
        where: {
          id: listingId,
          isAvailable: true,
          product: { isActive: true },
          organization: { type: 'DEALER', status: 'ACTIVE', dealerPublicProfile: { isNot: null } },
        },
        include: {
          organization: {
            select: {
              id: true,
              kycRecords: { orderBy: { revision: 'desc' }, take: 1, select: { status: true } },
            },
          },
        },
      });
      if (!listing || listing.organization.kycRecords[0]?.status !== 'VERIFIED') {
        throw new AppError(404, 'CATALOGUE_LISTING_NOT_FOUND', 'Medicine listing was not found.');
      }
      if (quantity < listing.minimumQuantity) {
        throw new AppError(
          422,
          'MINIMUM_QUANTITY_REQUIRED',
          `Minimum order quantity is ${listing.minimumQuantity}.`,
        );
      }
      const existing = await transaction.cart.findUnique({
        where: { pharmacyOrganizationId: context.organizationId },
        include: { _count: { select: { items: true } } },
      });
      if (
        existing &&
        existing.dealerOrganizationId !== listing.organizationId &&
        existing._count.items > 0
      ) {
        throw new AppError(
          409,
          'CART_DEALER_CONFLICT',
          'Checkout one dealer at a time. Clear the current cart before choosing another dealer.',
        );
      }
      const cart = existing
        ? await transaction.cart.update({
            where: { id: existing.id },
            data: { dealerOrganizationId: listing.organizationId },
          })
        : await transaction.cart.create({
            data: {
              pharmacyOrganizationId: context.organizationId,
              dealerOrganizationId: listing.organizationId,
            },
          });
      await transaction.cartItem.upsert({
        where: {
          cartId_dealerCatalogueItemId: { cartId: cart.id, dealerCatalogueItemId: listing.id },
        },
        create: { cartId: cart.id, dealerCatalogueItemId: listing.id, quantity },
        update: { quantity },
      });
      await transaction.auditLog.create({
        data: {
          requestId: context.requestId,
          actorUserId: context.userId,
          organizationId: context.organizationId,
          action: 'pharmacy.cart_item_set',
          resourceType: 'cart',
          resourceId: cart.id,
          outcome: 'SUCCESS',
          details: { listingId, quantity },
        },
      });
    });
    return this.cart(sessionId, context);
  }

  async removeCartItem(sessionId: string, context: RequestContext, listingId: string) {
    await this.authorizePharmacy(sessionId, context, PERMISSIONS.ORDER_CREATE);
    await this.database.$transaction(async (transaction) => {
      const cart = await transaction.cart.findUnique({
        where: { pharmacyOrganizationId: context.organizationId },
        select: { id: true },
      });
      if (!cart) return;
      await transaction.cartItem.deleteMany({
        where: { cartId: cart.id, dealerCatalogueItemId: listingId },
      });
      const remaining = await transaction.cartItem.count({ where: { cartId: cart.id } });
      if (remaining === 0) await transaction.cart.delete({ where: { id: cart.id } });
      await transaction.auditLog.create({
        data: {
          requestId: context.requestId,
          actorUserId: context.userId,
          organizationId: context.organizationId,
          action: 'pharmacy.cart_item_removed',
          resourceType: 'cart',
          resourceId: cart.id,
          outcome: 'SUCCESS',
          details: { listingId },
        },
      });
    });
    return this.cart(sessionId, context);
  }

  async checkout(sessionId: string, context: RequestContext, input: PharmacyCheckoutInput) {
    await this.authorizePharmacy(sessionId, context, PERMISSIONS.ORDER_CREATE);
    const order = await this.database.$transaction(async (transaction) => {
      await this.lockOrganization(transaction, context.organizationId, 'PHARMACY');
      const locked = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM carts
        WHERE "pharmacyOrganizationId" = ${context.organizationId}::uuid
        FOR UPDATE
      `;
      if (!locked[0]) throw new AppError(409, 'CART_EMPTY', 'Your cart is empty.');
      const cart = await transaction.cart.findUniqueOrThrow({
        where: { id: locked[0].id },
        include: {
          dealerOrganization: {
            include: {
              dealerPublicProfile: true,
              kycRecords: { orderBy: { revision: 'desc' }, take: 1, select: { status: true } },
            },
          },
          pharmacyOrganization: {
            include: { pharmacyProfile: { include: { primaryAddress: true } } },
          },
          items: { include: { catalogueItem: { include: { product: true } } } },
        },
      });
      if (cart.items.length === 0) throw new AppError(409, 'CART_EMPTY', 'Your cart is empty.');
      if (
        cart.dealerOrganization.status !== 'ACTIVE' ||
        !cart.dealerOrganization.dealerPublicProfile ||
        cart.dealerOrganization.kycRecords[0]?.status !== 'VERIFIED'
      ) {
        throw new AppError(409, 'DEALER_UNAVAILABLE', 'The dealer is not currently available.');
      }
      const address = cart.pharmacyOrganization.pharmacyProfile?.primaryAddress;
      if (!address) {
        throw new AppError(
          409,
          'SHIPPING_ADDRESS_REQUIRED',
          'Complete the pharmacy address before checkout.',
        );
      }
      let subtotal = 0n;
      for (const item of cart.items) {
        const listing = item.catalogueItem;
        if (
          listing.organizationId !== cart.dealerOrganizationId ||
          !listing.isAvailable ||
          !listing.product.isActive ||
          item.quantity < listing.minimumQuantity ||
          listing.currency !== 'INR'
        ) {
          throw new AppError(
            409,
            'CART_ITEM_UNAVAILABLE',
            `${listing.product.name} is no longer available at the selected quantity.`,
          );
        }
        subtotal += listing.unitPriceMinor * BigInt(item.quantity);
      }
      const created = await transaction.order.create({
        data: {
          orderNumber: orderNumber(),
          pharmacyOrganizationId: context.organizationId,
          dealerOrganizationId: cart.dealerOrganizationId,
          placedByUserId: context.userId,
          paymentMethod: input.paymentMethod,
          currency: 'INR',
          subtotalMinor: subtotal,
          taxMinor: 0n,
          deliveryChargeMinor: 0n,
          totalMinor: subtotal,
          shippingAddress: {
            name: address.name,
            line1: address.line1,
            line2: address.line2,
            city: address.city,
            district: address.district,
            state: address.state,
            stateCode: address.stateCode,
            postalCode: address.postalCode,
            country: address.country,
          },
          items: {
            create: cart.items.map(({ catalogueItem, quantity }) => ({
              dealerCatalogueItemId: catalogueItem.id,
              productId: catalogueItem.product.id,
              productName: catalogueItem.product.name,
              genericName: catalogueItem.product.genericName,
              strength: catalogueItem.product.strength,
              dosageForm: catalogueItem.product.dosageForm,
              packSize: catalogueItem.product.packSize,
              sku: catalogueItem.sku,
              unitPriceMinor: catalogueItem.unitPriceMinor,
              quantity,
              lineTotalMinor: catalogueItem.unitPriceMinor * BigInt(quantity),
            })),
          },
          statusHistory: {
            create: { toStatus: 'PENDING', changedByUserId: context.userId },
          },
        },
        include: orderInclude,
      });
      await transaction.cart.delete({ where: { id: cart.id } });
      await transaction.auditLog.create({
        data: {
          requestId: context.requestId,
          actorUserId: context.userId,
          organizationId: context.organizationId,
          action: 'pharmacy.order_placed',
          resourceType: 'order',
          resourceId: created.id,
          outcome: 'SUCCESS',
          details: { orderNumber: created.orderNumber, dealerId: created.dealerOrganizationId },
        },
      });
      await transaction.outboxEvent.create({
        data: {
          aggregateType: 'order',
          aggregateId: created.id,
          eventType: 'order.placed',
          payload: {
            orderNumber: created.orderNumber,
            pharmacyOrganizationId: created.pharmacyOrganizationId,
            dealerOrganizationId: created.dealerOrganizationId,
          },
        },
      });
      return created;
    });
    return this.publicOrder(order);
  }

  async pharmacyOrders(sessionId: string, context: RequestContext, query: OrderQuery) {
    await this.authorizePharmacy(sessionId, context, PERMISSIONS.ORDER_READ);
    return this.listOrders({ pharmacyOrganizationId: context.organizationId }, query);
  }

  async pharmacyOrder(sessionId: string, context: RequestContext, orderId: string) {
    await this.authorizePharmacy(sessionId, context, PERMISSIONS.ORDER_READ);
    return this.scopedOrder({ id: orderId, pharmacyOrganizationId: context.organizationId });
  }

  async cancelPharmacyOrder(sessionId: string, context: RequestContext, orderId: string) {
    await this.authorizePharmacy(sessionId, context, PERMISSIONS.ORDER_CREATE);
    return this.changeStatus(
      context,
      { id: orderId, pharmacyOrganizationId: context.organizationId },
      {
        status: 'CANCELLED',
        note: 'Cancelled by pharmacy',
      },
      ['PENDING'],
    );
  }

  async dealerOrders(sessionId: string, context: RequestContext, query: OrderQuery) {
    await this.authorizeDealer(sessionId, context, PERMISSIONS.ORDER_READ);
    return this.listOrders({ dealerOrganizationId: context.organizationId }, query);
  }

  async dealerOrder(sessionId: string, context: RequestContext, orderId: string) {
    await this.authorizeDealer(sessionId, context, PERMISSIONS.ORDER_READ);
    return this.scopedOrder({ id: orderId, dealerOrganizationId: context.organizationId });
  }

  async updateDealerOrder(
    sessionId: string,
    context: RequestContext,
    orderId: string,
    input: DealerOrderStatusInput,
  ) {
    await this.authorizeDealer(sessionId, context, PERMISSIONS.ORDER_MANAGE);
    const order = await this.database.order.findFirst({
      where: { id: orderId, dealerOrganizationId: context.organizationId },
      select: { status: true },
    });
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order was not found.');
    if (!dealerTransitions[order.status].includes(input.status)) {
      throw new AppError(
        409,
        'ORDER_STATUS_TRANSITION_INVALID',
        `Order cannot move from ${order.status} to ${input.status}.`,
      );
    }
    return this.changeStatus(
      context,
      { id: orderId, dealerOrganizationId: context.organizationId },
      input,
      [order.status],
    );
  }

  private async changeStatus(
    context: RequestContext,
    where: { id: string; pharmacyOrganizationId?: string; dealerOrganizationId?: string },
    input: DealerOrderStatusInput,
    allowedFrom: OrderStatusValue[],
  ) {
    const updated = await this.database.$transaction(async (transaction) => {
      const records = await transaction.$queryRaw<Array<{ id: string; status: OrderStatusValue }>>(
        Prisma.sql`SELECT id, status::text as status FROM orders WHERE id = ${where.id}::uuid FOR UPDATE`,
      );
      const locked = records[0];
      if (!locked) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order was not found.');
      const scoped = await transaction.order.findFirst({ where, select: { id: true } });
      if (!scoped) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order was not found.');
      if (!allowedFrom.includes(locked.status)) {
        throw new AppError(409, 'ORDER_STATUS_CHANGED', 'Order status changed. Refresh and retry.');
      }
      const order = await transaction.order.update({
        where: { id: locked.id },
        data: {
          status: input.status,
          statusHistory: {
            create: {
              fromStatus: locked.status,
              toStatus: input.status,
              changedByUserId: context.userId,
              note: input.note,
            },
          },
        },
        include: orderInclude,
      });
      await transaction.auditLog.create({
        data: {
          requestId: context.requestId,
          actorUserId: context.userId,
          organizationId: context.organizationId,
          action: 'order.status_changed',
          resourceType: 'order',
          resourceId: order.id,
          outcome: 'SUCCESS',
          details: { fromStatus: locked.status, toStatus: input.status },
        },
      });
      await transaction.outboxEvent.create({
        data: {
          aggregateType: 'order',
          aggregateId: order.id,
          eventType: 'order.status_changed',
          payload: { fromStatus: locked.status, toStatus: input.status },
        },
      });
      return order;
    });
    return this.publicOrder(updated);
  }

  private async listOrders(
    scope: { pharmacyOrganizationId?: string; dealerOrganizationId?: string },
    query: OrderQuery,
  ) {
    const records = await this.database.order.findMany({
      where: { ...scope, ...(query.status ? { status: query.status } : {}) },
      orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1,
      include: orderInclude,
    });
    const hasMore = records.length > query.limit;
    const page = records.slice(0, query.limit);
    return {
      orders: page.map((order) => this.publicOrderSummary(order)),
      page: { nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null, hasMore },
    };
  }

  private async scopedOrder(where: {
    id: string;
    pharmacyOrganizationId?: string;
    dealerOrganizationId?: string;
  }) {
    const order = await this.database.order.findFirst({ where, include: orderInclude });
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order was not found.');
    return this.publicOrder(order);
  }

  private publicOrderSummary(order: {
    id: string;
    orderNumber: string;
    status: OrderStatusValue;
    paymentMethod: 'CASH_ON_DELIVERY' | 'BANK_TRANSFER' | 'ONLINE';
    paymentStatus: 'PENDING' | 'AUTHORIZED' | 'PAID' | 'FAILED' | 'CANCELLED' | 'REFUNDED';
    currency: string;
    subtotalMinor: bigint;
    taxMinor: bigint;
    deliveryChargeMinor: bigint;
    totalMinor: bigint;
    placedAt: Date;
    updatedAt: Date;
    pharmacyOrganization: { id: string; legalName: string; tradeName: string | null };
    dealerOrganization: { id: string; legalName: string; tradeName: string | null };
    items: Array<{ quantity: number }>;
  }) {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      pharmacy: {
        id: order.pharmacyOrganization.id,
        name: organizationName(order.pharmacyOrganization),
      },
      dealer: {
        id: order.dealerOrganization.id,
        name: organizationName(order.dealerOrganization),
      },
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
      subtotal: { amountMinor: order.subtotalMinor.toString(), currency: order.currency },
      tax: { amountMinor: order.taxMinor.toString(), currency: order.currency },
      deliveryCharge: {
        amountMinor: order.deliveryChargeMinor.toString(),
        currency: order.currency,
      },
      total: { amountMinor: order.totalMinor.toString(), currency: order.currency },
      placedAt: order.placedAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }

  private publicOrder(order: {
    id: string;
    orderNumber: string;
    status: OrderStatusValue;
    paymentMethod: 'CASH_ON_DELIVERY' | 'BANK_TRANSFER' | 'ONLINE';
    paymentStatus: 'PENDING' | 'AUTHORIZED' | 'PAID' | 'FAILED' | 'CANCELLED' | 'REFUNDED';
    currency: string;
    subtotalMinor: bigint;
    taxMinor: bigint;
    deliveryChargeMinor: bigint;
    totalMinor: bigint;
    placedAt: Date;
    updatedAt: Date;
    pharmacyOrganization: { id: string; legalName: string; tradeName: string | null };
    dealerOrganization: { id: string; legalName: string; tradeName: string | null };
    shippingAddress: Prisma.JsonValue;
    items: Array<{
      dealerCatalogueItemId: string | null;
      productId: string;
      productName: string;
      genericName: string | null;
      strength: string | null;
      dosageForm: string | null;
      packSize: string | null;
      sku: string | null;
      unitPriceMinor: bigint;
      quantity: number;
      lineTotalMinor: bigint;
    }>;
    statusHistory: Array<{
      id: string;
      fromStatus: OrderStatusValue | null;
      toStatus: OrderStatusValue;
      note: string | null;
      createdAt: Date;
    }>;
  }) {
    return {
      ...this.publicOrderSummary(order),
      items: order.items.map((item) => ({
        listingId: item.dealerCatalogueItemId,
        productId: item.productId,
        name: item.productName,
        genericName: item.genericName,
        strength: item.strength,
        dosageForm: item.dosageForm,
        packSize: item.packSize,
        sku: item.sku,
        unitPrice: { amountMinor: item.unitPriceMinor.toString(), currency: order.currency },
        quantity: item.quantity,
        lineTotal: { amountMinor: item.lineTotalMinor.toString(), currency: order.currency },
      })),
      shippingAddress: order.shippingAddress,
      statusHistory: order.statusHistory.map((entry) => ({
        id: entry.id,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        note: entry.note,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }

  private publicCart(cart: {
    id: string;
    updatedAt: Date;
    dealerOrganization: { id: string; legalName: string; tradeName: string | null };
    items: Array<{
      quantity: number;
      catalogueItem: {
        id: string;
        sku: string | null;
        unitPriceMinor: bigint;
        currency: string;
        product: {
          id: string;
          name: string;
          genericName: string | null;
          strength: string | null;
          dosageForm: string | null;
          packSize: string | null;
        };
      };
    }>;
  }) {
    const subtotal = cart.items.reduce(
      (sum, item) => sum + item.catalogueItem.unitPriceMinor * BigInt(item.quantity),
      0n,
    );
    const currency = cart.items[0]?.catalogueItem.currency ?? 'INR';
    return {
      id: cart.id,
      dealer: {
        id: cart.dealerOrganization.id,
        name: organizationName(cart.dealerOrganization),
      },
      items: cart.items.map(({ catalogueItem, quantity }) => ({
        listingId: catalogueItem.id,
        productId: catalogueItem.product.id,
        name: catalogueItem.product.name,
        genericName: catalogueItem.product.genericName,
        strength: catalogueItem.product.strength,
        dosageForm: catalogueItem.product.dosageForm,
        packSize: catalogueItem.product.packSize,
        sku: catalogueItem.sku,
        unitPrice: { amountMinor: catalogueItem.unitPriceMinor.toString(), currency },
        quantity,
        lineTotal: {
          amountMinor: (catalogueItem.unitPriceMinor * BigInt(quantity)).toString(),
          currency,
        },
      })),
      itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
      subtotal: { amountMinor: subtotal.toString(), currency },
      tax: { amountMinor: '0', currency, configured: false },
      deliveryCharge: { amountMinor: '0', currency, configured: false },
      total: { amountMinor: subtotal.toString(), currency },
      pricingNotice:
        'Tax and delivery charges are zero until approved configuration is available; no regulatory tax assumptions are applied.',
      updatedAt: cart.updatedAt.toISOString(),
    };
  }

  private async authorizePharmacy(
    sessionId: string,
    context: RequestContext,
    permission: typeof PERMISSIONS.ORDER_CREATE | typeof PERMISSIONS.ORDER_READ,
  ) {
    await this.authorize(sessionId, context, 'PHARMACY');
    requirePermission(context, permission);
  }

  private async authorizeDealer(
    sessionId: string,
    context: RequestContext,
    permission: typeof PERMISSIONS.ORDER_READ | typeof PERMISSIONS.ORDER_MANAGE,
  ) {
    await this.authorize(sessionId, context, 'DEALER');
    requirePermission(context, permission);
  }

  private async authorize(
    sessionId: string,
    context: RequestContext,
    organizationType: 'PHARMACY' | 'DEALER',
  ) {
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
          roles: { some: { role: { organizationType } } },
        },
        activeOrganization: { type: organizationType, status: 'ACTIVE' },
      },
      select: { id: true },
    });
    if (!session) throw new AuthorizationError();
  }

  private async lockOrganization(
    transaction: Prisma.TransactionClient,
    organizationId: string,
    organizationType: 'PHARMACY' | 'DEALER',
  ) {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM organizations
      WHERE id = ${organizationId}::uuid
        AND type = ${organizationType}::"OrganizationType"
        AND status = 'ACTIVE'
      FOR UPDATE
    `);
    if (rows.length !== 1) throw new AuthorizationError();
  }
}
