import 'server-only';

import { cookies } from 'next/headers';
import {
  adminKycQueueSchema,
  adminKycReviewSchema,
  adminSessionSchema,
  adminDocumentCenterSchema,
  documentDetailSchema,
} from '@ligimed/validation';

async function readDocuments(path: string) {
  const credential = await adminCookie();
  if (!credential) return null;
  const response = await fetch(`${apiBaseUrl()}/api/v1/admin/documents/${path}`, {
    headers: { cookie: `${credential.cookieName}=${encodeURIComponent(credential.token)}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401 || response.status === 403) return null;
  if (response.status === 404) return 'NOT_FOUND' as const;
  if (!response.ok) throw new Error('Document review is unavailable.');
  return (await response.json()) as unknown;
}
export async function readAdminDocuments(query: URLSearchParams) {
  const result = await readDocuments(`?${query}`);
  return result && result !== 'NOT_FOUND' ? adminDocumentCenterSchema.parse(result) : null;
}
export async function readAdminDocument(id: string) {
  const result = await readDocuments(`uploads/${id}`);
  return result === 'NOT_FOUND' ? result : result ? documentDetailSchema.parse(result) : null;
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

async function adminCookie() {
  const cookieName = `${process.env['SESSION_COOKIE_NAME'] ?? 'ligimed_session'}_admin`;
  const token = (await cookies()).get(cookieName)?.value;
  return token ? { cookieName, token } : null;
}

export async function readAdminSession() {
  const credential = await adminCookie();
  if (!credential) return null;
  const response = await fetch(`${apiBaseUrl()}/api/v1/admin/auth/session`, {
    headers: { cookie: `${credential.cookieName}=${encodeURIComponent(credential.token)}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error('Admin authentication service unavailable');
  return adminSessionSchema.parse(await response.json());
}

export async function readAdminKycQueue(cursor?: string) {
  const credential = await adminCookie();
  if (!credential) return null;
  const query = new URLSearchParams({ limit: '20' });
  if (cursor) query.set('cursor', cursor);
  const response = await fetch(`${apiBaseUrl()}/api/v1/admin/reviews/kyc?${query}`, {
    headers: { cookie: `${credential.cookieName}=${encodeURIComponent(credential.token)}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error('KYC review service unavailable');
  return adminKycQueueSchema.parse(await response.json());
}

export async function readAdminKycReview(id: string) {
  const credential = await adminCookie();
  if (!credential) return null;
  const response = await fetch(`${apiBaseUrl()}/api/v1/admin/reviews/kyc/${id}`, {
    headers: { cookie: `${credential.cookieName}=${encodeURIComponent(credential.token)}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403) return null;
  if (response.status === 404) return 'NOT_FOUND' as const;
  if (!response.ok) throw new Error('KYC review service unavailable');
  return adminKycReviewSchema.parse(await response.json());
}
