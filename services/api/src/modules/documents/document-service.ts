import { createHash, randomUUID } from 'node:crypto';
import { PERMISSIONS, requirePermission } from '@ligimed/auth';
import { Prisma, type PrismaClient, type Document } from '@ligimed/database';
import { organizationObjectKey, type PrivateObjectStorage } from '@ligimed/storage';
import type { RequestContext } from '@ligimed/types';
import {
  documentDefinitions,
  documentGroup,
  restrictedDocument,
  type DocumentRow,
  type DocumentDetail,
  type DocumentUploadMetadata,
  type documentListQuerySchema,
  type documentReviewInputSchema,
} from '@ligimed/validation';
import type { z } from 'zod';
import { AppError } from '../../platform/errors.js';
import { authorizeActivePharmacy } from '../../platform/pharmacy-authorization.js';
import { authorizeInternal } from '../../platform/internal-authorization.js';
import { recordPdf } from './record-pdf.js';

type ListQuery = z.infer<typeof documentListQuerySchema>;
type ReviewInput = z.infer<typeof documentReviewInputSchema>;
const date = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const day = (value: string) => new Date(`${value}T00:00:00Z`);
const mask = (value: string | null, category: string) =>
  value && ['PAN', 'REPRESENTATIVE_KYC', 'BANK_DOCUMENT'].includes(category)
    ? `••••${value.slice(-4)}`
    : value;

export function documentExpiryStatus(
  reviewStatus: string,
  expiresAt: string | null,
  thresholds: number[],
) {
  if (reviewStatus === 'REJECTED') return 'REJECTED' as const;
  if (expiresAt) {
    const remaining = Math.ceil((day(expiresAt).getTime() - day(today()).getTime()) / 86_400_000);
    if (remaining < 0) return 'EXPIRED' as const;
    if (remaining <= Math.max(...thresholds)) return 'EXPIRING_SOON' as const;
  }
  return reviewStatus as DocumentRow['status'];
}

function row(document: Document, thresholds: number[]): DocumentRow {
  return {
    id: document.id,
    source: 'UPLOAD',
    category: document.category as DocumentRow['category'],
    title: document.title,
    group: documentGroup(document.category),
    status: documentExpiryStatus(document.reviewStatus, date(document.expiresAt), thresholds),
    reviewStatus: document.reviewStatus,
    referenceNumber: mask(document.referenceNumber, document.category),
    holderName: document.holderName,
    licenceType: document.licenceType,
    designation: document.designation,
    issuedAt: date(document.issuedAt),
    expiresAt: date(document.expiresAt),
    bankAccountLast4: document.bankAccountLast4,
    bankIfsc: document.bankIfsc,
    originalFilename: document.originalFilename,
    contentType: document.contentType,
    contentLength: document.contentLength,
    createdAt: document.createdAt.toISOString(),
    rejectionReason: document.rejectionReason,
    orderId: document.orderId,
    invoiceId: document.invoiceId,
    viewPath: null,
    sensitive: documentGroup(document.category) !== 'TRANSACTIONS',
    superseded: false,
  };
}

function generated(
  id: string,
  source: 'INVOICE' | 'ORDER' | 'PAYMENT',
  category: DocumentRow['category'],
  title: string,
  referenceNumber: string,
  createdAt: Date,
  orderId: string | null,
  invoiceId: string | null,
): DocumentRow {
  return {
    id,
    source,
    category,
    title,
    group: documentGroup(category),
    status: 'RECORDED',
    reviewStatus: 'RECORDED',
    referenceNumber,
    holderName: null,
    licenceType: null,
    designation: null,
    issuedAt: date(createdAt),
    expiresAt: null,
    bankAccountLast4: null,
    bankIfsc: null,
    originalFilename: null,
    contentType: 'application/pdf',
    contentLength: null,
    createdAt: createdAt.toISOString(),
    rejectionReason: null,
    orderId,
    invoiceId,
    viewPath: invoiceId ? `/billing/${invoiceId}` : `/orders/${orderId}`,
    sensitive: source === 'PAYMENT',
    superseded: false,
  };
}

export class DocumentService {
  constructor(
    private readonly database: PrismaClient,
    private readonly storage: PrivateObjectStorage,
  ) {}

  async thresholds() {
    return (
      (await this.database.documentReminderPolicy.findUnique({ where: { id: 'pharmacy' } }))
        ?.thresholds ?? [90, 60, 30]
    );
  }

  private finance(context: RequestContext, category: string) {
    if (restrictedDocument(category)) requirePermission(context, PERMISSIONS.DOCUMENT_FINANCE);
  }

  private filtered(
    query: ListQuery,
    thresholds: number[],
    finance: boolean,
  ): Prisma.DocumentWhereInput {
    const cutoff = new Date(day(today()).getTime() + Math.max(...thresholds) * 86_400_000);
    const categories = documentDefinitions
      .filter(
        ([key, , group]) =>
          (!query.group || query.group === group) && (finance || !restrictedDocument(key)),
      )
      .map(([key]) => key);
    const where: Prisma.DocumentWhereInput = { category: { in: categories }, replacement: null };
    if (query.orderId) where.orderId = query.orderId;
    if (query.invoiceId) where.invoiceId = query.invoiceId;
    if (query.q)
      where.OR = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { referenceNumber: { contains: query.q, mode: 'insensitive' } },
        { originalFilename: { contains: query.q, mode: 'insensitive' } },
      ];
    if (query.status === 'EXPIRED') {
      where.expiresAt = { lt: day(today()) };
      where.reviewStatus = { not: 'REJECTED' };
    } else if (query.status === 'EXPIRING_SOON') {
      where.expiresAt = { gte: day(today()), lte: cutoff };
      where.reviewStatus = { not: 'REJECTED' };
    } else if (query.status === 'RECORDED' || query.status === 'NOT_UPLOADED')
      where.id = { in: [] };
    else if (query.status) {
      where.reviewStatus = query.status;
      if (query.status !== 'REJECTED')
        where.AND = [{ OR: [{ expiresAt: null }, { expiresAt: { gt: cutoff } }] }];
    }
    return where;
  }

  async center(sessionId: string, context: RequestContext, query: ListQuery) {
    await authorizeActivePharmacy(this.database, sessionId, context, PERMISSIONS.DOCUMENT_READ);
    const thresholds = await this.thresholds();
    const finance = context.permissions.has(PERMISSIONS.DOCUMENT_FINANCE);
    const take = query.page * query.limit;
    const where = {
      ...this.filtered(query, thresholds, finance),
      organizationId: context.organizationId,
    };
    const uploadsEnabled = !query.source || query.source === 'UPLOAD';
    const [uploads, uploadCount, latestKyc] = await Promise.all([
      uploadsEnabled
        ? this.database.document.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take,
          })
        : [],
      uploadsEnabled ? this.database.document.count({ where }) : 0,
      this.database.kycRecord.findFirst({
        where: { organizationId: context.organizationId },
        orderBy: { revision: 'desc' },
        include: { evidence: true },
      }),
    ]);
    const kycRows: DocumentRow[] = (latestKyc?.evidence ?? [])
      .filter((evidence) => finance || !restrictedDocument(evidence.category))
      .map((evidence) => {
        const reviewStatus =
          evidence.status === 'PENDING'
            ? latestKyc?.status === 'UNDER_REVIEW'
              ? 'UNDER_REVIEW'
              : 'PENDING_REVIEW'
            : evidence.status;
        return {
          id: evidence.id,
          source: 'KYC',
          category: evidence.category,
          title:
            documentDefinitions.find(([key]) => key === evidence.category)?.[1] ?? 'KYC evidence',
          group: documentGroup(evidence.category),
          status: documentExpiryStatus(reviewStatus, date(evidence.expiresAt), thresholds),
          reviewStatus,
          referenceNumber: mask(evidence.referenceNumber, evidence.category),
          holderName: latestKyc?.authorizedRepresentativeName ?? null,
          licenceType: null,
          designation: latestKyc?.authorizedRepresentativeRole ?? null,
          issuedAt: null,
          expiresAt: date(evidence.expiresAt),
          bankAccountLast4: null,
          bankIfsc: null,
          originalFilename: evidence.originalFilename,
          contentType: evidence.contentType,
          contentLength: evidence.contentLength,
          createdAt: evidence.createdAt.toISOString(),
          rejectionReason: evidence.rejectionReason ?? latestKyc?.rejectionReason ?? null,
          orderId: null,
          invoiceId: null,
          viewPath: '/onboarding',
          sensitive: true,
          superseded: false,
        };
      });
    const visibleKyc = kycRows.filter(
      (item) =>
        !query.orderId &&
        !query.invoiceId &&
        (!query.source || query.source === 'KYC') &&
        (!query.group || item.group === query.group) &&
        (!query.status || item.status === query.status) &&
        (!query.q ||
          `${item.title} ${item.referenceNumber ?? ''} ${item.originalFilename ?? ''}`
            .toLowerCase()
            .includes(query.q.toLowerCase())),
    );
    const showGenerated = !query.status || query.status === 'RECORDED';
    const allowInvoices =
      showGenerated &&
      (!query.source || query.source === 'INVOICE') &&
      (!query.group || query.group === 'TRANSACTIONS') &&
      context.permissions.has(PERMISSIONS.BILLING_READ);
    const allowOrders =
      showGenerated &&
      (!query.source || query.source === 'ORDER') &&
      (!query.group || query.group === 'TRANSACTIONS') &&
      context.permissions.has(PERMISSIONS.ORDER_READ);
    const allowPayments =
      showGenerated &&
      (!query.source || query.source === 'PAYMENT') &&
      (!query.group || query.group === 'FINANCE') &&
      finance &&
      context.permissions.has(PERMISSIONS.BILLING_READ);
    const invoiceWhere: Prisma.InvoiceWhereInput = {
      pharmacyOrganizationId: context.organizationId,
      ...(query.orderId ? { orderId: query.orderId } : {}),
      ...(query.invoiceId ? { id: query.invoiceId } : {}),
      ...(query.q
        ? {
            OR: [
              { referenceNumber: { contains: query.q, mode: 'insensitive' } },
              { counterpartyName: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const orderWhere: Prisma.OrderWhereInput = {
      pharmacyOrganizationId: context.organizationId,
      ...(query.orderId ? { id: query.orderId } : {}),
      ...(query.invoiceId ? { purchaseInvoice: { id: query.invoiceId } } : {}),
      ...(query.q ? { orderNumber: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const paymentWhere: Prisma.InvoicePaymentEntryWhereInput = { invoice: invoiceWhere };
    const [invoices, invoiceCount, orders, orderCount, payments, paymentCount] = await Promise.all([
      allowInvoices
        ? this.database.invoice.findMany({
            where: invoiceWhere,
            orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
            take,
          })
        : [],
      allowInvoices ? this.database.invoice.count({ where: invoiceWhere }) : 0,
      allowOrders
        ? this.database.order.findMany({
            where: orderWhere,
            orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
            take,
          })
        : [],
      allowOrders ? this.database.order.count({ where: orderWhere }) : 0,
      allowPayments
        ? this.database.invoicePaymentEntry.findMany({
            where: paymentWhere,
            include: { invoice: true },
            orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
            take,
          })
        : [],
      allowPayments ? this.database.invoicePaymentEntry.count({ where: paymentWhere }) : 0,
    ]);
    const rows = [
      ...uploads.map((item) => row(item, thresholds)),
      ...visibleKyc,
      ...invoices.map((item) =>
        generated(
          item.id,
          'INVOICE',
          item.type === 'RETAIL_SALE' ? 'SALES_INVOICE' : 'PURCHASE_INVOICE',
          `${item.type === 'RETAIL_SALE' ? 'Sale' : 'Purchase'} · ${item.counterpartyName}`,
          item.referenceNumber,
          item.recordedAt,
          item.orderId,
          item.id,
        ),
      ),
      ...orders.map((item) =>
        generated(
          item.id,
          'ORDER',
          'PURCHASE_ORDER',
          `Order ${item.orderNumber}`,
          item.orderNumber,
          item.placedAt,
          item.id,
          null,
        ),
      ),
      ...payments.map((item) =>
        generated(
          item.id,
          'PAYMENT',
          'PAYMENT_RECEIPT',
          `${item.type === 'PAYMENT' ? 'Payment' : 'Refund'} record · ${item.invoice.referenceNumber}`,
          item.reference ?? item.invoice.referenceNumber,
          item.recordedAt,
          item.invoice.orderId,
          item.invoiceId,
        ),
      ),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    const total = uploadCount + visibleKyc.length + invoiceCount + orderCount + paymentCount;
    const allWhere: Prisma.DocumentWhereInput = {
      organizationId: context.organizationId,
      replacement: null,
      category: {
        in: documentDefinitions
          .filter(([key]) => finance || !restrictedDocument(key))
          .map(([key]) => key),
      },
    };
    const counts = await Promise.all(
      ['VERIFIED', 'PENDING_REVIEW', 'UNDER_REVIEW', 'REJECTED', 'EXPIRING_SOON', 'EXPIRED'].map(
        (status) =>
          this.database.document.count({
            where: {
              ...this.filtered(
                { page: 1, limit: 20, status: status as ListQuery['status'] },
                thresholds,
                finance,
              ),
              organizationId: context.organizationId,
            },
          }),
      ),
    );
    const expiring = await this.database.document.findMany({
      where: {
        ...allWhere,
        expiresAt: { lte: new Date(day(today()).getTime() + Math.max(...thresholds) * 86400000) },
        reviewStatus: { not: 'REJECTED' },
      },
      orderBy: { expiresAt: 'asc' },
      take: 100,
    });
    const reminderRows = [
      ...expiring.map((item) => row(item, thresholds)),
      ...kycRows.filter(
        (item) => item.expiresAt && ['EXPIRED', 'EXPIRING_SOON'].includes(item.status),
      ),
    ];
    const reminders = reminderRows.map((item) => {
      const daysRemaining = Math.ceil(
        (day(item.expiresAt!).getTime() - day(today()).getTime()) / 86400000,
      );
      const thresholdDays =
        daysRemaining < 0 ? 0 : Math.min(...thresholds.filter((value) => daysRemaining <= value));
      return {
        id: item.id,
        source: item.source,
        title: item.title,
        expiresAt: item.expiresAt!,
        daysRemaining,
        thresholdDays,
      };
    });
    const checklistRows = await this.database.document.findMany({
      where: allWhere,
      orderBy: { createdAt: 'desc' },
      distinct: ['category'],
      select: { category: true, reviewStatus: true, expiresAt: true },
    });
    return {
      documents: rows.slice((query.page - 1) * query.limit, take),
      counts: {
        total: (await this.database.document.count({ where: allWhere })) + kycRows.length,
        verified: counts[0]! + kycRows.filter((item) => item.status === 'VERIFIED').length,
        pending:
          counts[1]! +
          counts[2]! +
          kycRows.filter((item) => ['PENDING_REVIEW', 'UNDER_REVIEW'].includes(item.status)).length,
        rejected: counts[3]! + kycRows.filter((item) => item.status === 'REJECTED').length,
        expiring: counts[4]! + kycRows.filter((item) => item.status === 'EXPIRING_SOON').length,
        expired: counts[5]! + kycRows.filter((item) => item.status === 'EXPIRED').length,
      },
      reminders,
      thresholds,
      checklist: documentDefinitions
        .filter(([, , group]) => ['BUSINESS', 'BANKING'].includes(group))
        .filter(([key]) => finance || !restrictedDocument(key))
        .map(([category]) => {
          const uploaded = checklistRows.find((item) => item.category === category);
          const existing = kycRows.find((item) => item.category === category);
          return {
            category,
            status: uploaded
              ? documentExpiryStatus(uploaded.reviewStatus, date(uploaded.expiresAt), thresholds)
              : (existing?.status ?? 'NOT_UPLOADED'),
          };
        }),
      page: { current: query.page, totalPages: Math.max(1, Math.ceil(total / query.limit)), total },
    };
  }

  async upload(
    sessionId: string,
    context: RequestContext,
    metadata: DocumentUploadMetadata,
    file: { filename: string; contentType: string; contents: Uint8Array },
  ): Promise<DocumentDetail> {
    await authorizeActivePharmacy(this.database, sessionId, context, PERMISSIONS.DOCUMENT_MANAGE);
    this.finance(context, metadata.category);
    const prior = await this.database.document.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: context.organizationId,
          idempotencyKey: metadata.idempotencyKey,
        },
      },
    });
    const checksum = createHash('sha256').update(file.contents).digest('hex');
    if (prior) {
      const matches =
        prior.checksumSha256 === checksum &&
        prior.originalFilename === file.filename &&
        prior.contentType === file.contentType &&
        prior.title === metadata.title &&
        prior.category === metadata.category &&
        prior.referenceNumber === metadata.referenceNumber &&
        prior.holderName === metadata.holderName &&
        prior.licenceType === metadata.licenceType &&
        prior.designation === metadata.designation &&
        date(prior.issuedAt) === metadata.issuedAt &&
        date(prior.expiresAt) === metadata.expiresAt &&
        prior.bankAccountLast4 === metadata.bankAccountLast4 &&
        prior.bankIfsc === metadata.bankIfsc &&
        prior.invoiceId === metadata.invoiceId &&
        (prior.orderId === metadata.orderId ||
          (!metadata.orderId && Boolean(metadata.invoiceId))) &&
        prior.replacesDocumentId === metadata.replacesDocumentId;
      if (!matches)
        throw new AppError(
          409,
          'UPLOAD_RETRY_CONFLICT',
          'This upload key was already used for different details or another file.',
        );
      return this.detail(sessionId, context, prior.id);
    }
    const id = randomUUID();
    const objectKey = organizationObjectKey(context.organizationId, id);
    await this.storage.put(
      {
        organizationId: context.organizationId,
        objectKey,
        contentType: file.contentType,
        contentLength: file.contents.byteLength,
        checksumSha256: checksum,
      },
      file.contents,
    );
    try {
      await this.database.$transaction(async (tx) => {
        await authorizeActivePharmacy(tx, sessionId, context, PERMISSIONS.DOCUMENT_MANAGE);
        if (metadata.orderId) requirePermission(context, PERMISSIONS.ORDER_READ);
        if (metadata.invoiceId) requirePermission(context, PERMISSIONS.BILLING_READ);
        if (
          metadata.orderId &&
          !(await tx.order.findFirst({
            where: { id: metadata.orderId, pharmacyOrganizationId: context.organizationId },
            select: { id: true },
          }))
        )
          throw new AppError(404, 'ORDER_NOT_FOUND', 'Linked order was not found.');
        const invoice = metadata.invoiceId
          ? await tx.invoice.findFirst({
              where: { id: metadata.invoiceId, pharmacyOrganizationId: context.organizationId },
              select: { id: true, orderId: true },
            })
          : null;
        if (metadata.invoiceId && !invoice)
          throw new AppError(404, 'INVOICE_NOT_FOUND', 'Linked invoice was not found.');
        if (invoice && metadata.orderId && invoice.orderId !== metadata.orderId)
          throw new AppError(
            422,
            'DOCUMENT_LINK_MISMATCH',
            'The invoice belongs to another order.',
          );
        if (metadata.replacesDocumentId) {
          await tx.$queryRaw`SELECT id FROM documents WHERE id = ${metadata.replacesDocumentId}::uuid AND "organizationId" = ${context.organizationId}::uuid FOR UPDATE`;
          const original = await tx.document.findFirst({
            where: {
              id: metadata.replacesDocumentId,
              organizationId: context.organizationId,
              category: metadata.category,
              replacement: null,
            },
          });
          if (!original)
            throw new AppError(
              409,
              'DOCUMENT_VERSION_CONFLICT',
              'The document already has a replacement or belongs to another category.',
            );
        }
        const { idempotencyKey, issuedAt, expiresAt, ...fields } = metadata;
        await tx.document.create({
          data: {
            id,
            organizationId: context.organizationId,
            ...fields,
            idempotencyKey,
            issuedAt: issuedAt ? day(issuedAt) : null,
            expiresAt: expiresAt ? day(expiresAt) : null,
            orderId: metadata.orderId ?? invoice?.orderId ?? null,
            objectKey,
            originalFilename: file.filename,
            contentType: file.contentType,
            contentLength: file.contents.byteLength,
            checksumSha256: checksum,
            uploadedById: context.userId,
          },
        });
        await this.audit(tx, context, id, 'document.uploaded', {
          category: metadata.category,
          replacesDocumentId: metadata.replacesDocumentId,
        });
      });
    } catch (error) {
      await this.storage.delete(objectKey);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const concurrent = await this.database.document.findUnique({
          where: {
            organizationId_idempotencyKey: {
              organizationId: context.organizationId,
              idempotencyKey: metadata.idempotencyKey,
            },
          },
          select: { id: true },
        });
        if (concurrent) return this.upload(sessionId, context, metadata, file);
        throw new AppError(
          409,
          'DOCUMENT_VERSION_CONFLICT',
          'A matching upload or replacement already exists.',
        );
      }
      throw error;
    }
    return this.detail(sessionId, context, id);
  }

  async detail(sessionId: string, context: RequestContext, id: string, admin = false) {
    if (admin)
      await authorizeInternal(this.database, sessionId, context, PERMISSIONS.DOCUMENT_REVIEW);
    else
      await authorizeActivePharmacy(this.database, sessionId, context, PERMISSIONS.DOCUMENT_READ);
    const document = await this.database.document.findFirst({
      where: {
        id,
        ...(admin
          ? { organization: { type: 'PHARMACY' as const } }
          : { organizationId: context.organizationId }),
      },
      include: {
        reviews: {
          include: { reviewer: { select: { displayName: true } } },
          orderBy: { createdAt: 'asc' },
        },
        replacement: { select: { id: true } },
      },
    });
    if (!document) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document was not found.');
    this.finance(context, document.category);
    const versions: Array<{ id: string; title: string; createdAt: string; reviewStatus: string }> =
      [];
    let versionId: string | null = document.id;
    for (let depth = 0; versionId && depth < 100; depth++) {
      const newer: { id: string } | null = await this.database.document.findFirst({
        where: { replacesDocumentId: versionId, organizationId: document.organizationId },
        select: { id: true },
      });
      if (!newer) break;
      versionId = newer.id;
    }
    for (let depth = 0; versionId && depth < 100; depth++) {
      const version: Document | null = await this.database.document.findFirst({
        where: { id: versionId, organizationId: document.organizationId },
      });
      if (!version) break;
      versions.push({
        id: version.id,
        title: version.title,
        createdAt: version.createdAt.toISOString(),
        reviewStatus: version.reviewStatus,
      });
      versionId = version.replacesDocumentId;
    }
    return {
      ...row(document, await this.thresholds()),
      superseded: Boolean(document.replacement),
      reviews: document.reviews.map((review) => ({
        id: review.id,
        status: review.status,
        reason: review.reason,
        reviewerName: review.reviewer.displayName,
        createdAt: review.createdAt.toISOString(),
      })),
      versions,
    };
  }

  async content(
    sessionId: string,
    context: RequestContext,
    id: string,
    source: 'UPLOAD' | 'KYC',
    admin = false,
  ) {
    if (admin)
      await authorizeInternal(this.database, sessionId, context, PERMISSIONS.DOCUMENT_REVIEW);
    else
      await authorizeActivePharmacy(this.database, sessionId, context, PERMISSIONS.DOCUMENT_READ);
    const where = {
      id,
      ...(admin
        ? { organization: { type: 'PHARMACY' as const } }
        : { organizationId: context.organizationId }),
    };
    const document =
      source === 'UPLOAD'
        ? await this.database.document.findFirst({ where })
        : await this.database.kycEvidence.findFirst({ where });
    if (!document) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document was not found.');
    this.finance(context, document.category);
    const contents = await this.storage.read(document.objectKey);
    if (!contents)
      throw new AppError(503, 'DOCUMENT_UNAVAILABLE', 'The stored document is unavailable.');
    if (createHash('sha256').update(contents).digest('hex') !== document.checksumSha256)
      throw new AppError(
        503,
        'DOCUMENT_INTEGRITY_FAILURE',
        'The stored document could not be verified.',
      );
    await this.database.$transaction((tx) =>
      this.audit(tx, context, id, 'document.downloaded', { source }),
    );
    return {
      contents: Buffer.from(contents),
      contentType: document.contentType,
      filename: document.originalFilename,
    };
  }

  async adminCenter(sessionId: string, context: RequestContext, query: ListQuery) {
    await authorizeInternal(this.database, sessionId, context, PERMISSIONS.DOCUMENT_REVIEW);
    const thresholds = await this.thresholds();
    const where = {
      ...this.filtered(query, thresholds, context.permissions.has(PERMISSIONS.DOCUMENT_FINANCE)),
      organization: { type: 'PHARMACY' as const },
    };
    const [documents, total] = await Promise.all([
      this.database.document.findMany({
        where,
        include: { organization: { select: { legalName: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.database.document.count({ where }),
    ]);
    return {
      documents: documents.map((item) => ({
        ...row(item, thresholds),
        organizationName: item.organization.legalName,
      })),
      thresholds,
      page: { current: query.page, totalPages: Math.max(1, Math.ceil(total / query.limit)), total },
    };
  }

  async links(sessionId: string, context: RequestContext) {
    await authorizeActivePharmacy(this.database, sessionId, context, PERMISSIONS.DOCUMENT_MANAGE);
    const orders = context.permissions.has(PERMISSIONS.ORDER_READ)
      ? await this.database.order.findMany({
          where: { pharmacyOrganizationId: context.organizationId },
          orderBy: { placedAt: 'desc' },
          take: 100,
          select: { id: true, orderNumber: true },
        })
      : [];
    const invoices = context.permissions.has(PERMISSIONS.BILLING_READ)
      ? await this.database.invoice.findMany({
          where: { pharmacyOrganizationId: context.organizationId },
          orderBy: { recordedAt: 'desc' },
          take: 100,
          select: { id: true, referenceNumber: true, orderId: true },
        })
      : [];
    return { orders, invoices };
  }

  async generatedContent(
    sessionId: string,
    context: RequestContext,
    id: string,
    source: 'INVOICE' | 'ORDER' | 'PAYMENT',
  ) {
    await authorizeActivePharmacy(this.database, sessionId, context, PERMISSIONS.DOCUMENT_READ);
    requirePermission(
      context,
      source === 'ORDER' ? PERMISSIONS.ORDER_READ : PERMISSIONS.BILLING_READ,
    );
    if (source === 'PAYMENT') requirePermission(context, PERMISSIONS.DOCUMENT_FINANCE);
    const money = (minor: bigint) =>
      `INR ${minor / 100n}.${(minor % 100n).toString().padStart(2, '0')}`;
    let title: string;
    let reference: string;
    let lines: string[];
    if (source === 'ORDER') {
      const order = await this.database.order.findFirst({
        where: { id, pharmacyOrganizationId: context.organizationId },
        include: {
          items: true,
          dealerOrganization: true,
          statusHistory: { orderBy: { createdAt: 'asc' } },
        },
      });
      if (!order) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Order was not found.');
      title = 'Purchase order';
      reference = order.orderNumber;
      lines = [
        `Dealer: ${order.dealerOrganization.legalName}`,
        `Placed: ${order.placedAt.toISOString().slice(0, 10)}`,
        `Status: ${order.status}`,
        ...order.items.map(
          (item) => `${item.productName} | Qty ${item.quantity} | ${money(item.lineTotalMinor)}`,
        ),
        `Subtotal: ${money(order.subtotalMinor)}`,
        `Recorded tax: ${money(order.taxMinor)}`,
        `Delivery: ${money(order.deliveryChargeMinor)}`,
        `Total: ${money(order.totalMinor)}`,
        'Status history:',
        ...order.statusHistory.map((item) => `${item.createdAt.toISOString()} — ${item.toStatus}`),
      ];
    } else if (source === 'INVOICE') {
      const invoice = await this.database.invoice.findFirst({
        where: { id, pharmacyOrganizationId: context.organizationId },
        include: { lines: true, pharmacyOrganization: true, order: { include: { items: true } } },
      });
      if (!invoice) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Invoice was not found.');
      title = invoice.type === 'RETAIL_SALE' ? 'Sales bill record' : 'Dealer purchase record';
      reference = invoice.referenceNumber;
      lines = [
        `Pharmacy: ${invoice.pharmacyOrganization.legalName}`,
        `Counterparty: ${invoice.counterpartyName}`,
        `Recorded: ${invoice.recordedAt.toISOString().slice(0, 10)}`,
        ...invoice.lines.map(
          (item) =>
            `${item.productName} | Batch ${item.batchNumber} | Qty ${item.quantity} | ${money(item.lineTotalMinor)}`,
        ),
        ...(invoice.type === 'DEALER_PURCHASE'
          ? (invoice.order?.items.map(
              (item) =>
                `${item.productName} | Order quantity ${item.quantity} | Order line ${money(item.lineTotalMinor)}`,
            ) ?? [])
          : []),
        `Subtotal: ${money(invoice.subtotalMinor)}`,
        `Discount: ${money(invoice.discountMinor)}`,
        `Recorded tax: ${money(invoice.taxMinor)}`,
        `Delivery: ${money(invoice.deliveryChargeMinor)}`,
        `Total: ${money(invoice.totalMinor)}`,
      ];
    } else {
      const payment = await this.database.invoicePaymentEntry.findFirst({
        where: { id, invoice: { pharmacyOrganizationId: context.organizationId } },
        include: { invoice: true },
      });
      if (!payment) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Payment entry was not found.');
      title = payment.type === 'PAYMENT' ? 'Payment record' : 'Refund record';
      reference = payment.reference ?? payment.invoice.referenceNumber;
      lines = [
        `Invoice: ${payment.invoice.referenceNumber}`,
        `Counterparty: ${payment.invoice.counterpartyName}`,
        `Date: ${payment.occurredAt.toISOString()}`,
        `Method: ${payment.method}`,
        `Amount: ${money(payment.amountMinor)}`,
      ];
    }
    const contents = await recordPdf(title, reference, lines);
    await this.database.$transaction((tx) =>
      this.audit(tx, context, id, 'document.downloaded', { source }),
    );
    return {
      contents,
      contentType: 'application/pdf',
      filename: `${source.toLowerCase()}-${id}.pdf`,
    };
  }

  async review(sessionId: string, context: RequestContext, id: string, input: ReviewInput) {
    await this.database.$transaction(async (tx) => {
      await authorizeInternal(tx, sessionId, context, PERMISSIONS.DOCUMENT_REVIEW);
      await tx.$queryRaw`SELECT d.id FROM documents d JOIN organizations o ON o.id = d."organizationId" WHERE d.id = ${id}::uuid AND o.type = 'PHARMACY' FOR UPDATE OF d`;
      const document = await tx.document.findFirst({
        where: { id, organization: { type: 'PHARMACY' }, replacement: null },
      });
      if (!document)
        throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Current document was not found.');
      this.finance(context, document.category);
      const valid =
        input.status === 'UNDER_REVIEW'
          ? input.expectedStatus === 'PENDING_REVIEW'
          : input.expectedStatus === 'UNDER_REVIEW';
      if (!valid)
        throw new AppError(
          409,
          'DOCUMENT_REVIEW_TRANSITION',
          'Start review before making a decision.',
        );
      const changed = await tx.document.updateMany({
        where: { id, reviewStatus: input.expectedStatus, replacement: null },
        data: {
          reviewStatus: input.status,
          rejectionReason: input.status === 'REJECTED' ? input.reason : null,
        },
      });
      if (changed.count !== 1)
        throw new AppError(
          409,
          'DOCUMENT_REVIEW_CONFLICT',
          'The document has changed. Refresh before reviewing.',
        );
      await tx.documentReview.create({
        data: {
          documentId: id,
          reviewerId: context.userId,
          status: input.status,
          reason: input.reason,
        },
      });
      await this.audit(tx, context, id, 'document.reviewed', {
        status: input.status,
        ownerOrganizationId: document.organizationId,
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'document',
          aggregateId: id,
          eventType: 'document.reviewed',
          payload: { organizationId: document.organizationId, status: input.status },
        },
      });
    });
    return this.detail(sessionId, context, id, true);
  }

  async updatePolicy(sessionId: string, context: RequestContext, thresholds: number[]) {
    await this.database.$transaction(async (tx) => {
      await authorizeInternal(tx, sessionId, context, PERMISSIONS.DOCUMENT_POLICY);
      await tx.documentReminderPolicy.upsert({
        where: { id: 'pharmacy' },
        create: { id: 'pharmacy', thresholds },
        update: { thresholds },
      });
      await this.audit(tx, context, 'pharmacy', 'document.reminder_policy_updated', { thresholds });
    });
    return { thresholds };
  }

  async generateReminders() {
    const thresholds = await this.thresholds();
    const cutoff = new Date(day(today()).getTime() + Math.max(...thresholds) * 86400000);
    const documents = await this.database.document.findMany({
      where: {
        expiresAt: { lte: cutoff },
        replacement: null,
        reviewStatus: { not: 'REJECTED' },
        organization: { type: 'PHARMACY', status: 'ACTIVE' },
      },
      select: { id: true, organizationId: true, expiresAt: true },
    });
    const evidence = await this.database.kycEvidence.findMany({
      where: {
        expiresAt: { lte: cutoff },
        status: 'VERIFIED',
        organization: { type: 'PHARMACY', status: 'ACTIVE' },
        kycRecord: { status: 'VERIFIED' },
      },
      select: { id: true, organizationId: true, expiresAt: true },
    });
    let created = 0;
    for (const document of [
      ...documents.map((item) => ({ ...item, source: 'UPLOAD' as const })),
      ...evidence.map((item) => ({ ...item, source: 'KYC' as const })),
    ]) {
      const remaining = Math.ceil(
        (document.expiresAt!.getTime() - day(today()).getTime()) / 86400000,
      );
      const thresholdDays =
        remaining < 0 ? 0 : Math.min(...thresholds.filter((value) => remaining <= value));
      await this.database.$transaction(async (tx) => {
        if (document.source === 'UPLOAD') {
          const current = await tx.document.findFirst({
            where: {
              id: document.id,
              replacement: null,
              reviewStatus: { not: 'REJECTED' },
              organization: { status: 'ACTIVE' },
            },
          });
          if (!current) return;
        } else {
          const latest = await tx.kycRecord.findFirst({
            where: { organizationId: document.organizationId },
            orderBy: { revision: 'desc' },
            include: { evidence: { where: { id: document.id } } },
          });
          if (latest?.status !== 'VERIFIED' || !latest.evidence.length) return;
        }
        const inserted = await tx.documentReminder.createMany({
          data: {
            documentId: document.source === 'UPLOAD' ? document.id : null,
            kycEvidenceId: document.source === 'KYC' ? document.id : null,
            thresholdDays,
          },
          skipDuplicates: true,
        });
        if (inserted.count) {
          created++;
          await tx.outboxEvent.create({
            data: {
              aggregateType: 'document',
              aggregateId: document.id,
              eventType: 'document.expiry_reminder',
              payload: {
                organizationId: document.organizationId,
                source: document.source,
                thresholdDays,
                expiresAt: date(document.expiresAt),
              },
            },
          });
        }
      });
    }
    return { created };
  }

  async runReminders(sessionId: string, context: RequestContext) {
    await authorizeInternal(this.database, sessionId, context, PERMISSIONS.DOCUMENT_POLICY);
    const result = await this.generateReminders();
    await this.database.$transaction((tx) =>
      this.audit(tx, context, 'pharmacy', 'document.reminders_run', result),
    );
    return result;
  }

  private async audit(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    id: string,
    action: string,
    details: Prisma.InputJsonObject,
  ) {
    await tx.auditLog.create({
      data: {
        requestId: context.requestId,
        actorUserId: context.userId,
        organizationId: context.organizationId,
        action,
        resourceType: 'document',
        resourceId: id,
        outcome: 'SUCCESS',
        details,
      },
    });
  }
}
