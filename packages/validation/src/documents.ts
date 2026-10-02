import { z } from 'zod';

export const documentDefinitions = [
  ['DRUG_LICENCE', 'Drug licence', 'BUSINESS'],
  ['GST_REGISTRATION', 'GST registration', 'BUSINESS'],
  ['PAN', 'PAN', 'BUSINESS'],
  ['BUSINESS_REGISTRATION', 'Business registration', 'BUSINESS'],
  ['REPRESENTATIVE_KYC', 'Authorized person KYC', 'BUSINESS'],
  ['BANK_DOCUMENT', 'Bank verification', 'BANKING'],
  ['SETTLEMENT_STATEMENT', 'Settlement statement', 'FINANCE'],
  ['DEALER_INVOICE', 'Dealer invoice', 'TRANSACTIONS'],
  ['PURCHASE_INVOICE', 'Purchase invoice', 'TRANSACTIONS'],
  ['SALES_INVOICE', 'Sales bill', 'TRANSACTIONS'],
  ['GST_INVOICE', 'GST invoice supplied by issuer', 'TRANSACTIONS'],
  ['CREDIT_NOTE', 'Credit note', 'TRANSACTIONS'],
  ['DEBIT_NOTE', 'Debit note', 'TRANSACTIONS'],
  ['PURCHASE_ORDER', 'Purchase order', 'TRANSACTIONS'],
  ['ORDER_CONFIRMATION', 'Order confirmation', 'TRANSACTIONS'],
  ['RETURN_REQUEST', 'Return request', 'RETURNS'],
  ['RETURN_APPROVAL', 'Dealer return approval', 'RETURNS'],
  ['RETURN_RECEIPT', 'Return receipt', 'RETURNS'],
  ['PICKUP_CONFIRMATION', 'Pickup confirmation', 'RETURNS'],
  ['RETURN_CORRESPONDENCE', 'Return correspondence', 'RETURNS'],
  ['CREDIT_APPLICATION', 'Credit application', 'FINANCE'],
  ['CREDIT_AGREEMENT', 'Credit agreement', 'FINANCE'],
  ['REPAYMENT_SCHEDULE', 'Repayment schedule', 'FINANCE'],
  ['PAYMENT_RECEIPT', 'Payment record', 'FINANCE'],
  ['FINANCING_STATEMENT', 'Financing statement', 'FINANCE'],
  ['OTHER', 'Other document', 'BUSINESS'],
] as const;
export const documentCategorySchema = z.enum(documentDefinitions.map(([key]) => key));
export type DocumentCategory = z.infer<typeof documentCategorySchema>;
export const documentGroupSchema = z.enum([
  'BUSINESS',
  'BANKING',
  'TRANSACTIONS',
  'RETURNS',
  'FINANCE',
]);
export const documentReviewStatusSchema = z.enum([
  'PENDING_REVIEW',
  'UNDER_REVIEW',
  'VERIFIED',
  'REJECTED',
]);
export const documentStatusSchema = z.enum([
  'NOT_UPLOADED',
  'PENDING_REVIEW',
  'UNDER_REVIEW',
  'VERIFIED',
  'REJECTED',
  'EXPIRING_SOON',
  'EXPIRED',
  'RECORDED',
]);
export const documentSourceSchema = z.enum(['UPLOAD', 'KYC', 'INVOICE', 'ORDER', 'PAYMENT']);
export function documentGroup(category: string) {
  return documentDefinitions.find(([key]) => key === category)?.[2] ?? 'BUSINESS';
}
export function restrictedDocument(category: string) {
  return ['BANKING', 'FINANCE'].includes(documentGroup(category));
}
const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable().default(null);
export const documentUploadMetadataSchema = z
  .strictObject({
    idempotencyKey: z.uuid(),
    category: documentCategorySchema,
    title: z.string().trim().min(2).max(200),
    referenceNumber: nullableText(100),
    holderName: nullableText(200),
    licenceType: nullableText(100),
    designation: nullableText(100),
    issuedAt: z.iso.date().nullable().default(null),
    expiresAt: z.iso.date().nullable().default(null),
    bankAccountLast4: z
      .string()
      .regex(/^\d{4}$/)
      .nullable()
      .default(null),
    bankIfsc: z
      .string()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/)
      .nullable()
      .default(null),
    orderId: z.uuid().nullable().default(null),
    invoiceId: z.uuid().nullable().default(null),
    replacesDocumentId: z.uuid().nullable().default(null),
  })
  .refine((value) => !value.issuedAt || !value.expiresAt || value.expiresAt >= value.issuedAt, {
    message: 'Expiry date cannot precede issue date.',
  })
  .refine(
    (value) => value.category === 'BANK_DOCUMENT' || (!value.bankAccountLast4 && !value.bankIfsc),
    { message: 'Bank fields belong to bank verification documents.' },
  );
export type DocumentUploadMetadata = z.infer<typeof documentUploadMetadataSchema>;
export const documentListQuerySchema = z.strictObject({
  q: z.string().trim().max(100).optional(),
  group: documentGroupSchema.optional(),
  status: documentStatusSchema.optional(),
  source: documentSourceSchema.optional(),
  orderId: z.uuid().optional(),
  invoiceId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(100).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const documentReviewInputSchema = z
  .strictObject({
    expectedStatus: documentReviewStatusSchema,
    status: z.enum(['UNDER_REVIEW', 'VERIFIED', 'REJECTED']),
    reason: nullableText(1000),
  })
  .refine((value) => value.status !== 'REJECTED' || value.reason !== null, {
    message: 'A rejection reason is required.',
  });
export const documentPolicyInputSchema = z.strictObject({
  thresholds: z
    .array(z.number().int().min(1).max(3650))
    .min(1)
    .max(8)
    .refine((values) => new Set(values).size === values.length, {
      message: 'Reminder periods must be unique.',
    }),
});
export const documentRowSchema = z.object({
  id: z.uuid(),
  source: documentSourceSchema,
  category: documentCategorySchema,
  title: z.string(),
  group: documentGroupSchema,
  status: documentStatusSchema,
  reviewStatus: z.string(),
  referenceNumber: z.string().nullable(),
  holderName: z.string().nullable(),
  licenceType: z.string().nullable(),
  designation: z.string().nullable(),
  issuedAt: z.iso.date().nullable(),
  expiresAt: z.iso.date().nullable(),
  bankAccountLast4: z.string().nullable(),
  bankIfsc: z.string().nullable(),
  originalFilename: z.string().nullable(),
  contentType: z.string(),
  contentLength: z.number().int().nullable(),
  createdAt: z.iso.datetime(),
  rejectionReason: z.string().nullable(),
  orderId: z.uuid().nullable(),
  invoiceId: z.uuid().nullable(),
  viewPath: z.string().nullable(),
  sensitive: z.boolean(),
  superseded: z.boolean(),
});
export type DocumentRow = z.infer<typeof documentRowSchema>;
export const documentCenterSchema = z.object({
  documents: z.array(documentRowSchema),
  counts: z.object({
    total: z.number(),
    verified: z.number(),
    pending: z.number(),
    rejected: z.number(),
    expiring: z.number(),
    expired: z.number(),
  }),
  reminders: z.array(
    z.object({
      id: z.uuid(),
      source: documentSourceSchema,
      title: z.string(),
      expiresAt: z.iso.date(),
      daysRemaining: z.number().int(),
      thresholdDays: z.number().int(),
    }),
  ),
  thresholds: z.array(z.number().int()),
  checklist: z.array(z.object({ category: documentCategorySchema, status: documentStatusSchema })),
  page: z.object({
    current: z.number().int(),
    totalPages: z.number().int(),
    total: z.number().int(),
  }),
});
export type DocumentCenter = z.infer<typeof documentCenterSchema>;
export const documentDetailSchema = documentRowSchema.extend({
  reviews: z.array(
    z.object({
      id: z.uuid(),
      status: z.string(),
      reason: z.string().nullable(),
      reviewerName: z.string().nullable(),
      createdAt: z.iso.datetime(),
    }),
  ),
  versions: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      createdAt: z.iso.datetime(),
      reviewStatus: z.string(),
    }),
  ),
});
export type DocumentDetail = z.infer<typeof documentDetailSchema>;
export const adminDocumentCenterSchema = z.object({
  documents: z.array(documentRowSchema.extend({ organizationName: z.string() })),
  thresholds: z.array(z.number().int()),
  page: z.object({
    current: z.number().int(),
    totalPages: z.number().int(),
    total: z.number().int(),
  }),
});
