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
];

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const path = (await context.params).path.join('/');
  if (!routes.some((route) => route.method === request.method && route.pattern.test(path)))
    return new Response(null, { status: 404 });
  const forwarded = new Headers();
  for (const name of [
    'cookie',
    'origin',
    'content-type',
    'x-csrf-token',
    'x-file-name',
    'sec-fetch-site',
  ]) {
    const value = request.headers.get(name);
    if (value) forwarded.set(name, value);
  }
  const body = ['POST', 'PATCH'].includes(request.method) ? await request.arrayBuffer() : undefined;
  if (body && body.byteLength > (path === 'evidence' ? 5_242_880 : 32_768))
    return Response.json(
      { code: 'PAYLOAD_TOO_LARGE', detail: 'Request too large.' },
      { status: 413 },
    );
  const query = path === 'evidence' ? new URL(request.url).search : '';
  try {
    const response = await fetch(`${apiBaseUrl()}/api/v1/dealer/onboarding/${path}${query}`, {
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
      {
        code: 'ONBOARDING_SERVICE_UNAVAILABLE',
        detail: 'Dealer onboarding is temporarily unavailable.',
      },
      { status: 503 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
