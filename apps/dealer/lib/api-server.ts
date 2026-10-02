import 'server-only';

import {
  commerceOrderDetailSchema,
  commerceOrderListSchema,
  dealerCatalogueSchema,
  dealerKycStateSchema,
  dealerSessionSchema,
} from '@ligimed/validation';
import { cookies } from 'next/headers';

export function apiBaseUrl() {
  const url = new URL(process.env['API_INTERNAL_URL'] ?? 'http://127.0.0.1:4000');
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Invalid API_INTERNAL_URL');
  }
  return url.origin;
}

async function credential() {
  const name = `${process.env['SESSION_COOKIE_NAME'] ?? 'ligimed_session'}_dealer`;
  const token = (await cookies()).get(name)?.value;
  return token ? `${name}=${encodeURIComponent(token)}` : null;
}

async function read(path: string) {
  const cookie = await credential();
  if (!cookie) return null;
  const response = await fetch(`${apiBaseUrl()}/api/v1/dealer/${path}`, {
    headers: { cookie },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error('Dealer service unavailable');
  return response.json() as Promise<unknown>;
}

export async function readDealerSession() {
  const value = await read('auth/session');
  return value ? dealerSessionSchema.parse(value) : null;
}

export async function readDealerKycState() {
  const value = await read('onboarding/state');
  return value ? dealerKycStateSchema.parse(value) : null;
}

export async function readDealerCatalogue(input: {
  q?: string;
  availability?: 'ALL' | 'AVAILABLE' | 'UNAVAILABLE';
  cursor?: string;
}) {
  const query = new URLSearchParams({
    limit: '20',
    availability: input.availability ?? 'ALL',
  });
  if (input.q) query.set('q', input.q);
  if (input.cursor) query.set('cursor', input.cursor);
  const value = await read(`catalogue/listings?${query}`);
  return value ? dealerCatalogueSchema.parse(value) : null;
}

export async function readDealerOrders(input: {
  status?: string | undefined;
  cursor?: string | undefined;
}) {
  const query = new URLSearchParams({ limit: '20' });
  if (input.status) query.set('status', input.status);
  if (input.cursor) query.set('cursor', input.cursor);
  const value = await read(`commerce/orders?${query}`);
  return value ? commerceOrderListSchema.parse(value) : null;
}

export async function readDealerOrder(orderId: string) {
  const value = await read(`commerce/orders/${orderId}`);
  return value ? commerceOrderDetailSchema.parse(value) : null;
}
