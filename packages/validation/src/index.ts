import { ORGANIZATION_TYPES } from '@ligimed/types';
import { z } from 'zod';

export * from './documents.js';

export const idSchema = z.uuid();

export const customerListQuerySchema = z.strictObject({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).default('ACTIVE'),
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});
export const customerInputSchema = z.strictObject({
  displayName: z.string().trim().min(2).max(200),
  phoneNumber: z.union([z.string().regex(/^\+91[6-9]\d{9}$/), z.null()]),
  email: z.union([z.string().trim().toLowerCase().pipe(z.email().max(320)), z.null()]),
});
export const customerIdParamsSchema = z.strictObject({ customerId: idSchema });
export const customerSchema = z.object({
  id: idSchema,
  displayName: z.string(),
  phoneNumber: z.string().nullable(),
  email: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const customerListSchema = z.object({
  customers: z.array(customerSchema),
  page: z.object({ nextCursor: idSchema.nullable(), hasMore: z.boolean() }),
});
export type CustomerInput = z.infer<typeof customerInputSchema>;
export type CustomerList = z.infer<typeof customerListSchema>;

export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);
export const moneySchema = z.object({
  amountMinor: z.string().regex(/^-?\d+$/, 'Amount must be integer minor units'),
  currency: currencyCodeSchema,
});

const invoiceMinorSchema = z.string().regex(/^\d{1,12}$/);
export const retailSaleInputSchema = z.strictObject({
  idempotencyKey: idSchema,
  draftId: idSchema.optional(),
  customerId: idSchema,
  lines: z
    .array(
      z.strictObject({
        batchId: idSchema,
        quantity: z.number().int().min(1).max(10_000),
        unitPriceMinor: invoiceMinorSchema,
        discountMinor: invoiceMinorSchema.default('0'),
        taxMinor: invoiceMinorSchema,
      }),
    )
    .min(1)
    .max(20)
    .refine((lines) => new Set(lines.map((line) => line.batchId)).size === lines.length, {
      message: 'Each batch can appear only once.',
    })
    .refine(
      (lines) =>
        lines.every(
          (line) =>
            BigInt(line.discountMinor) <= BigInt(line.unitPriceMinor) * BigInt(line.quantity),
        ),
      { message: 'A line discount cannot exceed its subtotal.' },
    )
    .refine(
      (lines) =>
        lines.every(
          (line) => BigInt(line.taxMinor) <= BigInt(line.unitPriceMinor) * BigInt(line.quantity),
        ),
      { message: 'A line tax cannot exceed its subtotal.' },
    ),
});
export const retailDraftInputSchema = z.strictObject({
  customerId: idSchema.nullable(),
  lines: retailSaleInputSchema.shape.lines,
});
export const retailDraftIdParamsSchema = z.strictObject({ draftId: idSchema });
export const retailDraftSummarySchema = z.object({
  id: idSchema,
  customerName: z.string().nullable(),
  itemCount: z.number().int().nonnegative(),
  total: moneySchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const retailDraftSchema = retailDraftSummarySchema.extend({
  customerId: idSchema.nullable(),
  lines: z.array(
    z.object({
      batchId: idSchema,
      batch: z
        .object({
          id: idSchema,
          productId: idSchema,
          name: z.string(),
          genericName: z.string().nullable(),
          manufacturerName: z.string().nullable(),
          packSize: z.string().nullable(),
          batchNumber: z.string(),
          quantityOnHand: z.number().int(),
          expiresAt: z.iso.date(),
          reorderLevel: z.number().int(),
        })
        .nullable(),
      quantity: z.number().int(),
      unitPriceMinor: invoiceMinorSchema,
      discountMinor: invoiceMinorSchema,
      taxMinor: invoiceMinorSchema,
    }),
  ),
});
export const retailDraftListSchema = z.object({ drafts: z.array(retailDraftSummarySchema) });
export const customerPurchaseHistorySchema = z.object({
  purchaseCount: z.number().int().nonnegative(),
  recent: z.array(
    z.object({
      id: idSchema,
      recordedAt: z.iso.datetime(),
      productNames: z.array(z.string()),
      total: moneySchema,
    }),
  ),
});
export const purchaseInvoiceInputSchema = z.strictObject({
  orderId: idSchema,
  referenceNumber: z.string().trim().min(1).max(100),
  issuedAt: z.iso.date(),
  subtotalMinor: invoiceMinorSchema,
  taxMinor: invoiceMinorSchema,
  deliveryChargeMinor: invoiceMinorSchema,
});
export const invoiceListQuerySchema = z.strictObject({
  type: z.enum(['RETAIL_SALE', 'DEALER_PURCHASE']).optional(),
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const invoiceIdParamsSchema = z.strictObject({ invoiceId: idSchema });
export const invoicePaymentEntryInputSchema = z.strictObject({
  idempotencyKey: idSchema,
  type: z.enum(['PAYMENT', 'REFUND']),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'UPI', 'CARD', 'OTHER']),
  amountMinor: z.string().regex(/^[1-9]\d{0,11}$/),
  reference: z.string().trim().min(1).max(120).nullable(),
  occurredAt: z.iso.datetime({ offset: true }),
});
export const billingOptionsQuerySchema = z.strictObject({
  kind: z.enum(['customers', 'batches', 'orders']),
  q: z.string().trim().max(100).optional(),
});
export const billingOptionsSchema = z.object({
  customers: z.array(
    z.object({
      id: idSchema,
      name: z.string(),
      phoneNumber: z.string().nullable(),
      email: z.string().nullable(),
    }),
  ),
  batches: z.array(
    z.object({
      id: idSchema,
      productId: idSchema,
      name: z.string(),
      genericName: z.string().nullable(),
      manufacturerName: z.string().nullable(),
      packSize: z.string().nullable(),
      batchNumber: z.string(),
      quantityOnHand: z.number().int(),
      expiresAt: z.iso.date(),
      reorderLevel: z.number().int(),
    }),
  ),
  orders: z.array(
    z.object({
      id: idSchema,
      orderNumber: z.string(),
      dealerName: z.string(),
      status: z.string(),
      total: moneySchema,
    }),
  ),
});
export const invoiceSummarySchema = z.object({
  id: idSchema,
  type: z.enum(['RETAIL_SALE', 'DEALER_PURCHASE']),
  referenceNumber: z.string(),
  counterpartyName: z.string(),
  orderNumber: z.string().nullable(),
  total: moneySchema,
  reconciliation: z.enum(['NOT_APPLICABLE', 'PENDING_DELIVERY', 'AMOUNT_MISMATCH', 'MATCHED']),
  recordedAt: z.iso.datetime(),
});
export const invoiceListSchema = z.object({
  invoices: z.array(invoiceSummarySchema),
  page: z.object({ nextCursor: idSchema.nullable(), hasMore: z.boolean() }),
});
export const invoiceDetailSchema = invoiceSummarySchema.extend({
  subtotal: moneySchema,
  discount: moneySchema,
  tax: moneySchema,
  deliveryCharge: moneySchema,
  issuedAt: z.iso.date().nullable(),
  lines: z.array(
    z.object({
      id: idSchema,
      productName: z.string(),
      batchNumber: z.string(),
      quantity: z.number().int(),
      unitPrice: moneySchema,
      subtotal: moneySchema,
      discount: moneySchema,
      tax: moneySchema,
      total: moneySchema,
    }),
  ),
  orderItems: z.array(
    z.object({ productName: z.string(), quantity: z.number().int(), lineTotal: moneySchema }),
  ),
  paymentLedger: z.object({
    recordedNet: moneySchema,
    remaining: moneySchema,
    status: z.enum(['UNPAID', 'PARTIAL', 'RECORDED_IN_FULL']),
    entries: z.array(
      z.object({
        id: idSchema,
        type: z.enum(['PAYMENT', 'REFUND']),
        method: z.enum(['CASH', 'BANK_TRANSFER', 'UPI', 'CARD', 'OTHER']),
        amount: moneySchema,
        reference: z.string().nullable(),
        occurredAt: z.iso.datetime(),
        recordedAt: z.iso.datetime(),
      }),
    ),
  }),
});
export type RetailSaleInput = z.infer<typeof retailSaleInputSchema>;
export type PurchaseInvoiceInput = z.infer<typeof purchaseInvoiceInputSchema>;
export type InvoiceList = z.infer<typeof invoiceListSchema>;
export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>;
export type InvoicePaymentEntryInput = z.infer<typeof invoicePaymentEntryInputSchema>;
export type BillingOptions = z.infer<typeof billingOptionsSchema>;
export type RetailDraftInput = z.infer<typeof retailDraftInputSchema>;
export type RetailDraft = z.infer<typeof retailDraftSchema>;
export type RetailDraftList = z.infer<typeof retailDraftListSchema>;
export type CustomerPurchaseHistory = z.infer<typeof customerPurchaseHistorySchema>;

export const indianPhoneNumberSchema = z
  .string()
  .regex(/^\+91[6-9]\d{9}$/, 'Use an Indian phone number in E.164 format');

export const pharmacyOtpRequestSchema = z.discriminatedUnion('intent', [
  z.strictObject({ intent: z.literal('LOGIN'), phoneNumber: indianPhoneNumberSchema }),
  z.strictObject({
    intent: z.literal('REGISTER'),
    phoneNumber: indianPhoneNumberSchema,
    displayName: z.string().trim().min(2).max(200),
    pharmacyName: z.string().trim().min(2).max(250),
  }),
]);

export const dealerOtpRequestSchema = z.discriminatedUnion('intent', [
  z.strictObject({ intent: z.literal('LOGIN'), phoneNumber: indianPhoneNumberSchema }),
  z.strictObject({
    intent: z.literal('REGISTER'),
    phoneNumber: indianPhoneNumberSchema,
    displayName: z.string().trim().min(2).max(200),
    dealerName: z.string().trim().min(2).max(250),
  }),
]);

export const pharmacyOtpVerifySchema = z.strictObject({
  challengeId: idSchema,
  code: z.string().regex(/^\d{6}$/),
});

export const pharmacySelectionSchema = z.strictObject({
  challengeId: idSchema,
  membershipId: idSchema,
});

export type PharmacyOtpRequest = z.infer<typeof pharmacyOtpRequestSchema>;

export const pharmacySessionSchema = z.object({
  user: z.object({ id: idSchema, displayName: z.string().nullable() }),
  pharmacy: z.object({
    id: idSchema,
    name: z.string(),
    status: z.enum(['PENDING', 'ACTIVE']),
  }),
  access: z.enum(['FULL', 'ONBOARDING']),
  expiresAt: z.iso.datetime(),
  csrfToken: z.string(),
});
export type PharmacySession = z.infer<typeof pharmacySessionSchema>;

export const pharmacyAuthResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('AUTHENTICATED') }),
  z.object({
    status: z.literal('SELECT_PHARMACY'),
    memberships: z.array(z.object({ id: idSchema, name: z.string() })),
  }),
]);

export const dealerAuthResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('AUTHENTICATED') }),
  z.object({
    status: z.literal('SELECT_DEALER'),
    memberships: z.array(z.object({ id: idSchema, name: z.string() })),
  }),
]);

export const dealerSessionSchema = z.object({
  user: z.object({ id: idSchema, displayName: z.string().nullable() }),
  dealer: z.object({
    id: idSchema,
    name: z.string(),
    status: z.enum(['PENDING', 'ACTIVE']),
  }),
  access: z.enum(['FULL', 'ONBOARDING']),
  expiresAt: z.iso.datetime(),
  csrfToken: z.string(),
});
export type DealerSession = z.infer<typeof dealerSessionSchema>;

/** One canonical OTP subject prevents case/whitespace aliases bypassing rate limits. */
export const otpIdentifierSchema = z
  .string()
  .trim()
  .max(320)
  .toLowerCase()
  .pipe(z.union([z.email(), indianPhoneNumberSchema]));

export const organizationTypeSchema = z.enum(ORGANIZATION_TYPES);

export const pageQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const indianAddressSchema = z.object({
  name: z.string().trim().min(1).max(200),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  district: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  stateCode: z.string().trim().min(1).max(10),
  postalCode: z.string().regex(/^\d{6}$/, 'PIN code must contain 6 digits'),
  country: z.literal('IN').default('IN'),
});

const optionalTrimmedText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .transform((value) => (value === '' ? null : value));

const optionalWebsiteSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    if (value === '') return true;
    try {
      return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, 'Use a valid HTTP(S) website URL')
  .transform((value) => (value === '' ? null : value));

export const pharmacyKycProfileInputSchema = z.strictObject({
  legalName: z.string().trim().min(2).max(250),
  tradeName: optionalTrimmedText(250),
  operationalEmail: z
    .union([z.literal(''), z.email().max(320)])
    .transform((value) => (value === '' ? null : value.toLowerCase())),
  websiteUrl: optionalWebsiteSchema,
  authorizedRepresentativeName: z.string().trim().min(2).max(200),
  authorizedRepresentativeRole: optionalTrimmedText(100),
  address: indianAddressSchema.extend({
    line2: optionalTrimmedText(200),
  }),
});
export type PharmacyKycProfileInput = z.infer<typeof pharmacyKycProfileInputSchema>;

export const dealerKycProfileInputSchema = pharmacyKycProfileInputSchema.extend({
  summary: optionalTrimmedText(1000),
  serviceAreas: z.array(z.string().trim().min(2).max(100)).max(20),
});
export type DealerKycProfileInput = z.infer<typeof dealerKycProfileInputSchema>;

export const kycEvidenceCategories = [
  'DRUG_LICENCE',
  'GST_REGISTRATION',
  'PAN',
  'BUSINESS_REGISTRATION',
  'BANK_DOCUMENT',
  'OTHER',
] as const;

export const kycEvidenceMetadataSchema = z.strictObject({
  category: z.enum(kycEvidenceCategories),
  referenceNumber: optionalTrimmedText(100).optional().default(null),
  expiresAt: z
    .union([z.literal(''), z.iso.date()])
    .optional()
    .transform((value) => value || null),
});
export type KycEvidenceMetadata = z.infer<typeof kycEvidenceMetadataSchema>;

export const kycSubmitSchema = z.strictObject({
  declarationAccepted: z.literal(true),
});

export const pharmacyKycStateSchema = z.object({
  pharmacy: z.object({
    legalName: z.string(),
    tradeName: z.string().nullable(),
    operationalEmail: z.string().nullable(),
    websiteUrl: z.string().nullable(),
    address: z
      .object({
        name: z.string(),
        line1: z.string(),
        line2: z.string().nullable(),
        city: z.string(),
        district: z.string(),
        state: z.string(),
        stateCode: z.string(),
        postalCode: z.string(),
        country: z.literal('IN'),
      })
      .nullable(),
  }),
  kyc: z.object({
    id: idSchema.nullable(),
    revision: z.number().int().positive().nullable(),
    status: z.enum(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED']),
    authorizedRepresentativeName: z.string(),
    authorizedRepresentativeRole: z.string().nullable(),
    submittedAt: z.iso.datetime().nullable(),
    rejectionReason: z.string().nullable(),
    editable: z.boolean(),
    evidence: z.array(
      z.object({
        id: idSchema,
        category: z.enum(kycEvidenceCategories),
        referenceNumber: z.string().nullable(),
        expiresAt: z.iso.date().nullable(),
        originalFilename: z.string(),
        contentType: z.string(),
        contentLength: z.number().int().nonnegative(),
        status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']),
        rejectionReason: z.string().nullable(),
        uploadedAt: z.iso.datetime(),
      }),
    ),
  }),
  policyNotice: z.string(),
});
export type PharmacyKycState = z.infer<typeof pharmacyKycStateSchema>;

export const dealerKycStateSchema = pharmacyKycStateSchema.omit({ pharmacy: true }).extend({
  dealer: pharmacyKycStateSchema.shape.pharmacy.extend({
    summary: z.string().nullable(),
    serviceAreas: z.array(z.string()),
  }),
});
export type DealerKycState = z.infer<typeof dealerKycStateSchema>;

const unavailableMetricSchema = z.object({
  value: z.null(),
  available: z.literal(false),
  availableIn: z.string(),
});

export const pharmacyDashboardSchema = z.object({
  user: z.object({ displayName: z.string().nullable() }),
  pharmacy: z.object({
    id: idSchema,
    name: z.string(),
    status: z.enum(['PENDING', 'ACTIVE']),
  }),
  access: z.enum(['ONBOARDING', 'FULL']),
  onboarding: z.object({
    kycStatus: z
      .enum(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED'])
      .nullable(),
    submittedAt: z.iso.datetime().nullable(),
    action: z.enum([
      'COMPLETE_KYC',
      'AWAIT_REVIEW',
      'RESOLVE_REJECTION',
      'AWAIT_ACTIVATION',
      'NONE',
    ]),
  }),
  metrics: z.object({
    todaysOrders: unavailableMetricSchema,
    pendingOrders: unavailableMetricSchema,
    completedOrders: unavailableMetricSchema,
    inventoryValue: unavailableMetricSchema,
    lowStockProducts: unavailableMetricSchema,
    nearExpiryProducts: unavailableMetricSchema,
    outstandingPayments: unavailableMetricSchema,
  }),
  recentPurchases: z.array(z.never()),
  importantNotifications: z.array(z.never()),
});
export type PharmacyDashboard = z.infer<typeof pharmacyDashboardSchema>;

export const pharmacyMarketplaceQuerySchema = z.strictObject({
  q: z.string().trim().max(100).optional(),
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(24).default(12),
});
export type PharmacyMarketplaceQuery = z.infer<typeof pharmacyMarketplaceQuerySchema>;

export const pharmacyMarketplaceSchema = z.object({
  dealers: z.array(
    z.object({
      id: idSchema,
      name: z.string(),
      verificationStatus: z.literal('VERIFIED'),
      summary: z.string().nullable(),
      location: z.object({ city: z.string(), state: z.string() }),
      serviceAreas: z.array(z.string()),
      catalogue: z.object({
        available: z.literal(true),
      }),
    }),
  ),
  page: z.object({ nextCursor: idSchema.nullable(), hasMore: z.boolean() }),
});
export type PharmacyMarketplace = z.infer<typeof pharmacyMarketplaceSchema>;

export const pharmacyDealerIdSchema = z.object({ dealerId: idSchema });
export const pharmacyCatalogueQuerySchema = z.strictObject({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(150).optional(),
  manufacturer: z.string().trim().max(250).optional(),
  dosageForm: z.string().trim().max(100).optional(),
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const catalogueProductSchema = z.object({
  id: idSchema,
  name: z.string(),
  genericName: z.string().nullable(),
  strength: z.string().nullable(),
  dosageForm: z.string().nullable(),
  packSize: z.string().nullable(),
  description: z.string().nullable(),
  manufacturer: z.string().nullable(),
  category: z.string().nullable(),
});

export const pharmacyDealerDetailSchema = z.object({
  dealer: z.object({
    id: idSchema,
    name: z.string(),
    verificationStatus: z.literal('VERIFIED'),
    summary: z.string().nullable(),
    location: z.object({ city: z.string(), state: z.string() }),
    serviceAreas: z.array(z.string()),
  }),
});

export const pharmacyDealerCatalogueSchema = z.object({
  dealer: pharmacyDealerDetailSchema.shape.dealer,
  products: z.array(
    catalogueProductSchema.extend({
      listingId: idSchema,
      sku: z.string().nullable(),
      unitPrice: moneySchema,
      minimumQuantity: z.number().int().positive(),
      isAvailable: z.boolean(),
    }),
  ),
  filters: z.object({
    categories: z.array(z.string()),
    manufacturers: z.array(z.string()),
    dosageForms: z.array(z.string()),
  }),
  page: z.object({ nextCursor: idSchema.nullable(), hasMore: z.boolean() }),
});

export const pharmacyCatalogueListingParamsSchema = z.strictObject({
  dealerId: idSchema,
  listingId: idSchema,
});

export const pharmacyCatalogueListingSchema = z.object({
  dealer: pharmacyDealerDetailSchema.shape.dealer,
  product: catalogueProductSchema.extend({
    listingId: idSchema,
    sku: z.string().nullable(),
    unitPrice: moneySchema,
    minimumQuantity: z.number().int().positive(),
    isAvailable: z.literal(true),
  }),
});

const catalogueMinorAmountSchema = z
  .string()
  .regex(/^\d{1,12}$/, 'Price must be a positive integer amount in minor units')
  .refine((value) => BigInt(value) > 0n, 'Price must be greater than zero');

export const dealerCatalogueQuerySchema = z.strictObject({
  q: z.string().trim().max(100).optional(),
  availability: z.enum(['ALL', 'AVAILABLE', 'UNAVAILABLE']).default('ALL'),
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const dealerCatalogueListingInputSchema = z.strictObject({
  name: z.string().trim().min(2).max(250),
  genericName: optionalTrimmedText(250),
  strength: optionalTrimmedText(100),
  dosageForm: optionalTrimmedText(100),
  packSize: optionalTrimmedText(100),
  description: optionalTrimmedText(2000),
  manufacturerName: optionalTrimmedText(250),
  categoryName: optionalTrimmedText(150),
  sku: optionalTrimmedText(100),
  unitPriceMinor: catalogueMinorAmountSchema,
  currency: z.literal('INR').default('INR'),
  minimumQuantity: z.number().int().min(1).max(1_000_000),
  isAvailable: z.boolean().default(true),
});
export type DealerCatalogueListingInput = z.infer<typeof dealerCatalogueListingInputSchema>;

export const dealerCatalogueListingUpdateSchema = z.strictObject({
  sku: optionalTrimmedText(100),
  unitPriceMinor: catalogueMinorAmountSchema,
  currency: z.literal('INR').default('INR'),
  minimumQuantity: z.number().int().min(1).max(1_000_000),
  isAvailable: z.boolean(),
});
export type DealerCatalogueListingUpdate = z.infer<typeof dealerCatalogueListingUpdateSchema>;

export const dealerCatalogueListingParamsSchema = z.strictObject({ listingId: idSchema });

export const dealerCatalogueItemSchema = catalogueProductSchema.extend({
  listingId: idSchema,
  sku: z.string().nullable(),
  unitPrice: moneySchema,
  minimumQuantity: z.number().int().positive(),
  isAvailable: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type DealerCatalogueItem = z.infer<typeof dealerCatalogueItemSchema>;

export const dealerCatalogueSchema = z.object({
  products: z.array(dealerCatalogueItemSchema),
  page: z.object({ nextCursor: idSchema.nullable(), hasMore: z.boolean() }),
});
export type DealerCatalogue = z.infer<typeof dealerCatalogueSchema>;

export const orderStatuses = [
  'PENDING',
  'CONFIRMED',
  'PREPARING',
  'PACKED',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
  'CANCELLED',
  'REJECTED',
  'RETURN_REQUESTED',
  'RETURNED',
] as const;
export const orderStatusSchema = z.enum(orderStatuses);
export type OrderStatusValue = z.infer<typeof orderStatusSchema>;
export const paymentMethods = ['CASH_ON_DELIVERY', 'BANK_TRANSFER', 'ONLINE'] as const;
export const paymentMethodSchema = z.enum(paymentMethods);
export const paymentStatusSchema = z.enum([
  'PENDING',
  'AUTHORIZED',
  'PAID',
  'FAILED',
  'CANCELLED',
  'REFUNDED',
]);

export const pharmacyCartItemParamsSchema = z.strictObject({ listingId: idSchema });
export const pharmacyCartItemInputSchema = z.strictObject({
  quantity: z.number().int().min(1).max(1_000_000),
});
export const pharmacyCheckoutSchema = z.strictObject({ paymentMethod: paymentMethodSchema });
export type PharmacyCheckoutInput = z.infer<typeof pharmacyCheckoutSchema>;
export const pharmacyOrderCancelSchema = z.strictObject({});

const commerceProductSnapshotSchema = z.object({
  listingId: idSchema.nullable(),
  productId: idSchema,
  name: z.string(),
  genericName: z.string().nullable(),
  strength: z.string().nullable(),
  dosageForm: z.string().nullable(),
  packSize: z.string().nullable(),
  sku: z.string().nullable(),
  unitPrice: moneySchema,
  quantity: z.number().int().positive(),
  lineTotal: moneySchema,
});

export const pharmacyCartSchema = z.object({
  cart: z
    .object({
      id: idSchema,
      dealer: z.object({ id: idSchema, name: z.string() }),
      items: z.array(commerceProductSnapshotSchema.extend({ listingId: idSchema })),
      itemCount: z.number().int().nonnegative(),
      subtotal: moneySchema,
      tax: moneySchema.extend({ configured: z.boolean() }),
      deliveryCharge: moneySchema.extend({ configured: z.boolean() }),
      total: moneySchema,
      pricingNotice: z.string(),
      updatedAt: z.iso.datetime(),
    })
    .nullable(),
});
export type PharmacyCart = z.infer<typeof pharmacyCartSchema>;

export const commerceOrderQuerySchema = z.strictObject({
  status: orderStatusSchema.optional(),
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const commerceOrderParamsSchema = z.strictObject({ orderId: idSchema });
export const dealerOrderStatusInputSchema = z.strictObject({
  status: orderStatusSchema,
  note: optionalTrimmedText(500).optional().default(null),
});
export type DealerOrderStatusInput = z.infer<typeof dealerOrderStatusInputSchema>;

const orderPartySchema = z.object({ id: idSchema, name: z.string() });
const orderSummarySchema = z.object({
  id: idSchema,
  orderNumber: z.string(),
  pharmacy: orderPartySchema,
  dealer: orderPartySchema,
  status: orderStatusSchema,
  paymentMethod: paymentMethodSchema,
  paymentStatus: paymentStatusSchema,
  itemCount: z.number().int().positive(),
  subtotal: moneySchema,
  tax: moneySchema,
  deliveryCharge: moneySchema,
  total: moneySchema,
  placedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const commerceOrderListSchema = z.object({
  orders: z.array(orderSummarySchema),
  page: z.object({ nextCursor: idSchema.nullable(), hasMore: z.boolean() }),
});

export const commerceOrderDetailSchema = orderSummarySchema.extend({
  items: z.array(commerceProductSnapshotSchema),
  shippingAddress: indianAddressSchema.extend({ line2: z.string().nullable() }),
  statusHistory: z.array(
    z.object({
      id: idSchema,
      fromStatus: orderStatusSchema.nullable(),
      toStatus: orderStatusSchema,
      note: z.string().nullable(),
      createdAt: z.iso.datetime(),
    }),
  ),
});
export type CommerceOrderDetail = z.infer<typeof commerceOrderDetailSchema>;

export const inventoryStatusSchema = z.enum(['ALL', 'LOW_STOCK', 'NEAR_EXPIRY', 'EXPIRED']);
export const inventoryQuerySchema = z.strictObject({
  q: z.string().trim().max(100).optional(),
  status: inventoryStatusSchema.default('ALL'),
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const inventoryProductQuerySchema = z.strictObject({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const inventoryBatchInputSchema = z
  .strictObject({
    productId: idSchema,
    batchNumber: z.string().trim().min(1).max(100),
    quantity: z.number().int().min(1).max(10_000_000),
    purchasePriceMinor: z
      .string()
      .regex(/^\d{1,12}$/)
      .nullable()
      .default(null),
    manufacturedAt: z.iso.date().nullable().default(null),
    expiresAt: z.iso.date(),
    reorderLevel: z.number().int().min(0).max(10_000_000).default(10),
  })
  .superRefine((value, context) => {
    if (value.manufacturedAt && value.manufacturedAt > value.expiresAt) {
      context.addIssue({
        code: 'custom',
        path: ['manufacturedAt'],
        message: 'Manufacture date must not be after expiry date',
      });
    }
  });
export type InventoryBatchInput = z.infer<typeof inventoryBatchInputSchema>;
export const inventoryBatchParamsSchema = z.strictObject({ batchId: idSchema });
export const inventoryItemParamsSchema = z.strictObject({ itemId: idSchema });
export const inventoryAdjustmentInputSchema = z.strictObject({
  direction: z.enum(['IN', 'OUT']),
  quantity: z.number().int().min(1).max(10_000_000),
  reason: z.string().trim().min(3).max(500),
});
export type InventoryAdjustmentInput = z.infer<typeof inventoryAdjustmentInputSchema>;
export const inventoryThresholdInputSchema = z.strictObject({
  reorderLevel: z.number().int().min(0).max(10_000_000),
});

const inventoryProductSchema = z.object({
  id: idSchema,
  name: z.string(),
  genericName: z.string().nullable(),
  strength: z.string().nullable(),
  dosageForm: z.string().nullable(),
  packSize: z.string().nullable(),
});
export const inventoryProductsSchema = z.object({ products: z.array(inventoryProductSchema) });
export const pharmacyInventorySchema = z.object({
  summary: z.object({
    products: z.number().int().nonnegative(),
    units: z.number().int().nonnegative(),
    lowStock: z.number().int().nonnegative(),
    nearExpiry: z.number().int().nonnegative(),
    expired: z.number().int().nonnegative(),
    inventoryValue: moneySchema,
  }),
  items: z.array(
    z.object({
      id: idSchema,
      product: inventoryProductSchema,
      quantityOnHand: z.number().int().nonnegative(),
      reorderLevel: z.number().int().nonnegative(),
      lowStock: z.boolean(),
      nearestExpiry: z.iso.date().nullable(),
      nearExpiry: z.boolean(),
      expiredUnits: z.number().int().nonnegative(),
      value: moneySchema,
      batches: z.array(
        z.object({
          id: idSchema,
          batchNumber: z.string(),
          quantityOnHand: z.number().int().nonnegative(),
          purchasePrice: moneySchema.nullable(),
          manufacturedAt: z.iso.date().nullable(),
          expiresAt: z.iso.date(),
          receivedAt: z.iso.datetime(),
        }),
      ),
    }),
  ),
  page: z.object({ nextCursor: idSchema.nullable(), hasMore: z.boolean() }),
});
export type PharmacyInventory = z.infer<typeof pharmacyInventorySchema>;

export const adminOtpRequestSchema = z.strictObject({
  phoneNumber: indianPhoneNumberSchema,
});

export const adminSessionSchema = z.object({
  user: z.object({ id: idSchema, displayName: z.string().nullable() }),
  organization: z.object({ id: idSchema, name: z.string() }),
  expiresAt: z.iso.datetime(),
  csrfToken: z.string(),
});

export const adminKycQueueQuerySchema = z.strictObject({
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const adminKycDecisionSchema = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('APPROVE') }),
  z.strictObject({
    decision: z.literal('REJECT'),
    reason: z.string().trim().min(10).max(1000),
  }),
]);
export type AdminKycDecision = z.infer<typeof adminKycDecisionSchema>;
export const adminKycStartReviewSchema = z.strictObject({});

const adminKycQueueItemSchema = z.object({
  id: idSchema,
  revision: z.number().int().positive(),
  status: z.enum(['SUBMITTED', 'UNDER_REVIEW']),
  submittedAt: z.iso.datetime(),
  organization: z.object({ id: idSchema, name: z.string(), type: z.enum(['PHARMACY', 'DEALER']) }),
  representativeName: z.string(),
  evidenceCount: z.number().int().nonnegative(),
});

export const adminKycQueueSchema = z.object({
  records: z.array(adminKycQueueItemSchema),
  page: z.object({ nextCursor: idSchema.nullable(), hasMore: z.boolean() }),
});

export const adminKycReviewSchema = adminKycQueueItemSchema.extend({
  representativeRole: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  profile: z.object({
    legalName: z.string(),
    tradeName: z.string().nullable(),
    operationalEmail: z.string().nullable(),
    websiteUrl: z.string().nullable(),
    summary: z.string().nullable(),
    serviceAreas: z.array(z.string()),
    address: z
      .object({
        name: z.string(),
        line1: z.string(),
        line2: z.string().nullable(),
        city: z.string(),
        district: z.string(),
        state: z.string(),
        stateCode: z.string(),
        postalCode: z.string(),
        country: z.string(),
      })
      .nullable(),
  }),
  evidence: z.array(
    z.object({
      id: idSchema,
      category: z.enum(kycEvidenceCategories),
      referenceNumber: z.string().nullable(),
      expiresAt: z.iso.date().nullable(),
      originalFilename: z.string(),
      contentType: z.string(),
      status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']),
    }),
  ),
});
