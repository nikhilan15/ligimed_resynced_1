import { PERMISSIONS } from '@ligimed/auth';
import type { Prisma, PrismaClient } from '@ligimed/database';
import type { RequestContext } from '@ligimed/types';
import type { CustomerInput } from '@ligimed/validation';

import { AppError } from '../../platform/errors.js';
import { authorizeActivePharmacy } from '../../platform/pharmacy-authorization.js';

type CustomerQuery = {
  q?: string | undefined;
  status: 'ACTIVE' | 'ARCHIVED';
  cursor?: string | undefined;
  limit: number;
};

const customerSelect = {
  id: true,
  displayName: true,
  phoneNumber: true,
  email: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

function present(record: {
  id: string;
  displayName: string;
  phoneNumber: string | null;
  email: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    archivedAt: record.archivedAt?.toISOString() ?? null,
  };
}

export class CustomerService {
  constructor(private readonly database: PrismaClient) {}

  async list(sessionId: string, context: RequestContext, query: CustomerQuery) {
    await authorizeActivePharmacy(this.database, sessionId, context, PERMISSIONS.CUSTOMER_READ);
    if (query.cursor) {
      const cursor = await this.database.customer.findFirst({
        where: {
          id: query.cursor,
          organizationId: context.organizationId,
          archivedAt: query.status === 'ACTIVE' ? null : { not: null },
        },
        select: { id: true },
      });
      if (!cursor) throw new AppError(400, 'INVALID_CURSOR', 'The page cursor is invalid.');
    }
    const customers = await this.database.customer.findMany({
      where: {
        organizationId: context.organizationId,
        archivedAt: query.status === 'ACTIVE' ? null : { not: null },
        ...(query.q
          ? {
              OR: [
                { displayName: { contains: query.q, mode: 'insensitive' as const } },
                { phoneNumber: { contains: query.q } },
                { email: { contains: query.q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1,
      select: customerSelect,
    });
    const hasMore = customers.length > query.limit;
    const page = customers.slice(0, query.limit);
    return {
      customers: page.map(present),
      page: { hasMore, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null },
    };
  }

  async create(sessionId: string, context: RequestContext, input: CustomerInput) {
    return this.database.$transaction(async (tx) => {
      await authorizeActivePharmacy(tx, sessionId, context, PERMISSIONS.CUSTOMER_MANAGE);
      const customer = await tx.customer.create({
        data: { organizationId: context.organizationId, ...input },
        select: customerSelect,
      });
      await this.audit(tx, context, customer.id, 'customer.created');
      return present(customer);
    });
  }

  async update(
    sessionId: string,
    context: RequestContext,
    customerId: string,
    input: CustomerInput,
  ) {
    return this.database.$transaction(async (tx) => {
      await authorizeActivePharmacy(tx, sessionId, context, PERMISSIONS.CUSTOMER_MANAGE);
      const result = await tx.customer.updateMany({
        where: { id: customerId, organizationId: context.organizationId, archivedAt: null },
        data: input,
      });
      if (!result.count) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found.');
      await this.audit(tx, context, customerId, 'customer.updated');
      const customer = await tx.customer.findFirstOrThrow({
        where: { id: customerId, organizationId: context.organizationId },
        select: customerSelect,
      });
      return present(customer);
    });
  }

  async archive(sessionId: string, context: RequestContext, customerId: string) {
    return this.database.$transaction(async (tx) => {
      await authorizeActivePharmacy(tx, sessionId, context, PERMISSIONS.CUSTOMER_MANAGE);
      const result = await tx.customer.updateMany({
        where: { id: customerId, organizationId: context.organizationId, archivedAt: null },
        data: { archivedAt: new Date() },
      });
      if (!result.count) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found.');
      await this.audit(tx, context, customerId, 'customer.archived');
    });
  }

  async restore(sessionId: string, context: RequestContext, customerId: string) {
    return this.database.$transaction(async (tx) => {
      await authorizeActivePharmacy(tx, sessionId, context, PERMISSIONS.CUSTOMER_MANAGE);
      const result = await tx.customer.updateMany({
        where: {
          id: customerId,
          organizationId: context.organizationId,
          archivedAt: { not: null },
        },
        data: { archivedAt: null },
      });
      if (!result.count) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found.');
      await this.audit(tx, context, customerId, 'customer.restored');
    });
  }

  private async audit(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    id: string,
    action: string,
  ) {
    await tx.auditLog.create({
      data: {
        requestId: context.requestId,
        actorUserId: context.userId,
        organizationId: context.organizationId,
        action,
        resourceType: 'customer',
        resourceId: id,
        outcome: 'SUCCESS',
      },
    });
  }
}
