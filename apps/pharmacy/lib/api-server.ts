import 'server-only';

import { cookies } from 'next/headers';
import {
  commerceOrderDetailSchema,
  commerceOrderListSchema,
  pharmacyCartSchema,
  pharmacyDashboardSchema,
  pharmacyDealerCatalogueSchema,
  pharmacyCatalogueListingSchema,
  pharmacyKycStateSchema,
  pharmacyMarketplaceSchema,
  pharmacySessionSchema,
  pharmacyInventorySchema,
  inventoryProductsSchema,
  customerListSchema,
  invoiceListSchema,
  invoiceDetailSchema,
  documentCenterSchema,
  documentDetailSchema,
} from '@ligimed/validation';

export async function readDocumentCenter(query: URLSearchParams) {
  const result = await readDocuments(`?${query}`);
  return result && result !== 'NOT_FOUND' ? documentCenterSchema.parse(result) : null;
}
export async function readDocumentDetail(id: string) {
  const result = await readDocuments(`uploads/${id}`);
  return result === 'NOT_FOUND' ? result : result ? documentDetailSchema.parse(result) : null;
}
async function readDocuments(path: string) {
  const cookieName = process.env['SESSION_COOKIE_NAME'] ?? 'ligimed_session';
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const response = await fetch(`${apiBaseUrl()}/api/v1/pharmacy/documents/${path}`, {
    headers: { cookie: `${cookieName}=${encodeURIComponent(token)}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401 || response.status === 403) return null;
  if (response.status === 404) return 'NOT_FOUND' as const;
  if (!response.ok) throw new Error('Document center is unavailable.');
  return (await response.json()) as unknown;
}

export function apiBaseUrl() {
  const value = process.env['API_INTERNAL_URL'] ?? 'http://127.0.0.1:4000';
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Invalid API_INTERNAL_URL');
  return url.origin;
}

export async function readPharmacySession() {
  const cookieName = process.env['SESSION_COOKIE_NAME'] ?? 'ligimed_session';
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const response = await fetch(`${apiBaseUrl()}/api/v1/pharmacy/auth/session`, {
    headers: { cookie: `${cookieName}=${encodeURIComponent(token)}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error('Authentication service unavailable');
  return pharmacySessionSchema.parse(await response.json());
}

export async function readPharmacyKycState() {
  const cookieName = process.env['SESSION_COOKIE_NAME'] ?? 'ligimed_session';
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const response = await fetch(`${apiBaseUrl()}/api/v1/pharmacy/onboarding/state`, {
    headers: { cookie: `${cookieName}=${encodeURIComponent(token)}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error('Pharmacy onboarding service unavailable');
  return pharmacyKycStateSchema.parse(await response.json());
}

export async function readPharmacyDashboard() {
  const cookieName = process.env['SESSION_COOKIE_NAME'] ?? 'ligimed_session';
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const response = await fetch(`${apiBaseUrl()}/api/v1/pharmacy/dashboard`, {
    headers: { cookie: `${cookieName}=${encodeURIComponent(token)}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error('Pharmacy dashboard service unavailable');
  return pharmacyDashboardSchema.parse(await response.json());
}

export async function readPharmacyMarketplace(input: {
  q?: string;
  cursor?: string;
  limit?: number;
}) {
  const cookieName = process.env['SESSION_COOKIE_NAME'] ?? 'ligimed_session';
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const query = new URLSearchParams();
  if (input.q) query.set('q', input.q);
  if (input.cursor) query.set('cursor', input.cursor);
  if (input.limit) query.set('limit', String(input.limit));
  const response = await fetch(
    `${apiBaseUrl()}/api/v1/pharmacy/marketplace/dealers?${query.toString()}`,
    {
      headers: { cookie: `${cookieName}=${encodeURIComponent(token)}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (response.status === 401) return null;
  if (response.status === 403) return { status: 'LOCKED' as const };
  if (!response.ok) throw new Error('Pharmacy marketplace service unavailable');
  return { status: 'READY' as const, data: pharmacyMarketplaceSchema.parse(await response.json()) };
}

export async function readPharmacyDealerCatalogue(
  dealerId: string,
  input: {
    q?: string;
    category?: string;
    manufacturer?: string;
    dosageForm?: string;
    cursor?: string;
  },
) {
  const cookieName = process.env['SESSION_COOKIE_NAME'] ?? 'ligimed_session';
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const query = new URLSearchParams({ limit: '20' });
  if (input.q) query.set('q', input.q);
  if (input.category) query.set('category', input.category);
  if (input.manufacturer) query.set('manufacturer', input.manufacturer);
  if (input.dosageForm) query.set('dosageForm', input.dosageForm);
  if (input.cursor) query.set('cursor', input.cursor);
  const response = await fetch(
    `${apiBaseUrl()}/api/v1/pharmacy/marketplace/dealers/${dealerId}/catalogue?${query}`,
    {
      headers: { cookie: `${cookieName}=${encodeURIComponent(token)}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (response.status === 401) return null;
  if (response.status === 403) return { status: 'LOCKED' as const };
  if (response.status === 404) return { status: 'NOT_FOUND' as const };
  if (!response.ok) throw new Error('Dealer catalogue service unavailable');
  return {
    status: 'READY' as const,
    data: pharmacyDealerCatalogueSchema.parse(await response.json()),
  };
}

export async function readPharmacyCatalogueListing(dealerId: string, listingId: string) {
  const cookieName = process.env['SESSION_COOKIE_NAME'] ?? 'ligimed_session';
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const response = await fetch(
    `${apiBaseUrl()}/api/v1/pharmacy/marketplace/dealers/${dealerId}/catalogue/${listingId}`,
    {
      headers: { cookie: `${cookieName}=${encodeURIComponent(token)}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (response.status === 401) return null;
  if (response.status === 403) return { status: 'LOCKED' as const };
  if (response.status === 404) return { status: 'NOT_FOUND' as const };
  if (!response.ok) throw new Error('Medicine detail service unavailable');
  return {
    status: 'READY' as const,
    data: pharmacyCatalogueListingSchema.parse(await response.json()),
  };
}

async function readCommerce(path: string) {
  const cookieName = process.env['SESSION_COOKIE_NAME'] ?? 'ligimed_session';
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const response = await fetch(`${apiBaseUrl()}/api/v1/pharmacy/commerce/${path}`, {
    headers: { cookie: `${cookieName}=${encodeURIComponent(token)}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403) return null;
  if (response.status === 404) return { status: 'NOT_FOUND' as const };
  if (!response.ok) throw new Error('Commerce service unavailable');
  return { status: 'READY' as const, value: (await response.json()) as unknown };
}

export async function readPharmacyCart() {
  const result = await readCommerce('cart');
  return result?.status === 'READY' ? pharmacyCartSchema.parse(result.value) : null;
}

export async function readPharmacyOrders(input: {
  status?: string | undefined;
  cursor?: string | undefined;
}) {
  const query = new URLSearchParams({ limit: '20' });
  if (input.status) query.set('status', input.status);
  if (input.cursor) query.set('cursor', input.cursor);
  const result = await readCommerce(`orders?${query}`);
  return result?.status === 'READY' ? commerceOrderListSchema.parse(result.value) : null;
}

export async function readPharmacyOrder(orderId: string) {
  const result = await readCommerce(`orders/${orderId}`);
  if (!result) return null;
  if (result.status === 'NOT_FOUND') return result;
  return { status: 'READY' as const, data: commerceOrderDetailSchema.parse(result.value) };
}

async function readInventory(path: string) {
  const cookieName = process.env['SESSION_COOKIE_NAME'] ?? 'ligimed_session';
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const response = await fetch(`${apiBaseUrl()}/api/v1/pharmacy/inventory/${path}`, {
    headers: { cookie: `${cookieName}=${encodeURIComponent(token)}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error('Inventory service unavailable');
  return (await response.json()) as unknown;
}

export async function readPharmacyInventory(input: {
  q?: string | undefined;
  status?: string | undefined;
  cursor?: string | undefined;
}) {
  const query = new URLSearchParams({ limit: '20' });
  if (input.q) query.set('q', input.q);
  if (input.status) query.set('status', input.status);
  if (input.cursor) query.set('cursor', input.cursor);
  const result = await readInventory(`?${query}`);
  return result ? pharmacyInventorySchema.parse(result) : null;
}

export async function readInventoryProducts(q?: string) {
  const query = new URLSearchParams({ limit: '50' });
  if (q) query.set('q', q);
  const result = await readInventory(`products?${query}`);
  return result ? inventoryProductsSchema.parse(result) : null;
}

export async function readPharmacyCustomers(input: {
  q?: string;
  status?: 'ACTIVE' | 'ARCHIVED';
  cursor?: string;
}) {
  const cookieName = process.env['SESSION_COOKIE_NAME'] ?? 'ligimed_session';
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const query = new URLSearchParams({ limit: '25' });
  if (input.q) query.set('q', input.q);
  if (input.status) query.set('status', input.status);
  if (input.cursor) query.set('cursor', input.cursor);
  const response = await fetch(`${apiBaseUrl()}/api/v1/pharmacy/customers?${query}`, {
    headers: { cookie: `${cookieName}=${encodeURIComponent(token)}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error('Customer service unavailable');
  return customerListSchema.parse(await response.json());
}

export async function readPharmacyInvoices(input: { type?: string; cursor?: string }) {
  const cookieName = process.env['SESSION_COOKIE_NAME'] ?? 'ligimed_session';
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const query = new URLSearchParams({ limit: '20' });
  if (input.type) query.set('type', input.type);
  if (input.cursor) query.set('cursor', input.cursor);
  const response = await fetch(`${apiBaseUrl()}/api/v1/pharmacy/billing?${query}`, {
    headers: { cookie: `${cookieName}=${encodeURIComponent(token)}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error('Billing service unavailable');
  return invoiceListSchema.parse(await response.json());
}

export async function readPharmacyInvoice(invoiceId: string) {
  const cookieName = process.env['SESSION_COOKIE_NAME'] ?? 'ligimed_session';
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const response = await fetch(`${apiBaseUrl()}/api/v1/pharmacy/billing/${invoiceId}`, {
    headers: { cookie: `${cookieName}=${encodeURIComponent(token)}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403) return null;
  if (response.status === 404) return { status: 'NOT_FOUND' as const };
  if (!response.ok) throw new Error('Billing service unavailable');
  return { status: 'READY' as const, data: invoiceDetailSchema.parse(await response.json()) };
}
