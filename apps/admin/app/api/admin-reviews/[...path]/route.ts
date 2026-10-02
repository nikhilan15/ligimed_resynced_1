import { apiBaseUrl } from '../../../../lib/api-server';

const uuid =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
const routes = [
  { pattern: /^kyc$/, method: 'GET' },
  { pattern: new RegExp(`^kyc/${uuid}$`), method: 'GET' },
  { pattern: new RegExp(`^kyc/${uuid}/evidence/${uuid}/content$`), method: 'GET' },
  { pattern: new RegExp(`^kyc/${uuid}/start-review$`), method: 'POST' },
  { pattern: new RegExp(`^kyc/${uuid}/decision$`), method: 'POST' },
] as const;

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const path = (await context.params).path.join('/');
  const errorHeaders = {
    'cache-control': 'no-store, private',
    'content-type': 'application/problem+json',
  };
  if (!routes.some((route) => route.method === request.method && route.pattern.test(path))) {
    return new Response(null, { status: 404, headers: errorHeaders });
  }
  const forwarded = new Headers();
  for (const name of ['cookie', 'origin', 'content-type', 'x-csrf-token', 'sec-fetch-site']) {
    const value = request.headers.get(name);
    if (value) forwarded.set(name, value);
  }
  let body: ArrayBuffer | undefined;
  if (request.method === 'POST') {
    body = await request.arrayBuffer();
    if (body.byteLength > 4096) {
      return Response.json(
        { code: 'PAYLOAD_TOO_LARGE', detail: 'The request is too large.' },
        { status: 413, headers: errorHeaders },
      );
    }
  }
  const query = path === 'kyc' ? new URL(request.url).search : '';
  try {
    const response = await fetch(`${apiBaseUrl()}/api/v1/admin/reviews/${path}${query}`, {
      method: request.method,
      headers: forwarded,
      ...(body ? { body } : {}),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    const outgoing = new Headers({ 'cache-control': 'no-store, private' });
    for (const name of [
      'content-type',
      'content-disposition',
      'x-content-type-options',
      'x-request-id',
    ]) {
      const value = response.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    return new Response(response.status === 204 ? null : await response.arrayBuffer(), {
      status: response.status,
      headers: outgoing,
    });
  } catch {
    return Response.json(
      { code: 'KYC_REVIEW_UNAVAILABLE', detail: 'KYC review is temporarily unavailable.' },
      { status: 503, headers: errorHeaders },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
