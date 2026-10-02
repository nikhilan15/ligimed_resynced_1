import { apiBaseUrl } from '../../../../lib/api-server';

export const runtime = 'nodejs';

const uuid =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
const routes = [
  { pattern: /^state$/, method: 'GET' },
  { pattern: /^profile$/, method: 'PATCH' },
  { pattern: /^evidence$/, method: 'POST' },
  { pattern: new RegExp(`^evidence/${uuid}$`), method: 'DELETE' },
  { pattern: new RegExp(`^evidence/${uuid}/content$`), method: 'GET' },
  { pattern: /^submit$/, method: 'POST' },
] as const;

function errorHeaders() {
  return { 'cache-control': 'no-store, private', 'content-type': 'application/problem+json' };
}

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const path = (await context.params).path.join('/');
  if (!routes.some((route) => route.method === request.method && route.pattern.test(path))) {
    return new Response(null, { status: 404, headers: errorHeaders() });
  }
  const forwarded = new Headers();
  for (const name of [
    'cookie',
    'origin',
    'content-type',
    'content-length',
    'x-csrf-token',
    'x-file-name',
    'sec-fetch-site',
  ]) {
    const value = request.headers.get(name);
    if (value) forwarded.set(name, value);
  }
  let body: ArrayBuffer | undefined;
  if (['POST', 'PATCH'].includes(request.method)) {
    body = await request.arrayBuffer();
    const maximum = path === 'evidence' ? 5_242_880 : 32_768;
    if (body.byteLength > maximum) {
      return Response.json(
        { code: 'PAYLOAD_TOO_LARGE', detail: 'The request is too large.' },
        { status: 413, headers: errorHeaders() },
      );
    }
  }
  const query = path === 'evidence' ? new URL(request.url).search : '';
  try {
    const response = await fetch(`${apiBaseUrl()}/api/v1/pharmacy/onboarding/${path}${query}`, {
      method: request.method,
      headers: forwarded,
      ...(body !== undefined ? { body } : {}),
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
      {
        code: 'ONBOARDING_SERVICE_UNAVAILABLE',
        detail: 'Pharmacy onboarding is temporarily unavailable. Please try again shortly.',
      },
      { status: 503, headers: errorHeaders() },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
