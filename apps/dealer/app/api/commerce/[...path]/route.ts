import { apiBaseUrl } from '../../../../lib/api-server';

const uuid =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
const routes = [
  { pattern: /^orders$/, methods: new Set(['GET']) },
  { pattern: new RegExp(`^orders/${uuid}$`), methods: new Set(['GET']) },
  { pattern: new RegExp(`^orders/${uuid}/status$`), methods: new Set(['PATCH']) },
] as const;

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const path = (await context.params).path.join('/');
  if (!routes.some((route) => route.pattern.test(path) && route.methods.has(request.method))) {
    return new Response(null, { status: 404 });
  }
  const forwarded = new Headers();
  for (const name of ['cookie', 'origin', 'content-type', 'x-csrf-token', 'sec-fetch-site']) {
    const value = request.headers.get(name);
    if (value) forwarded.set(name, value);
  }
  const body = request.method === 'PATCH' ? await request.arrayBuffer() : undefined;
  if (body && body.byteLength > 8_192) {
    return Response.json(
      { code: 'PAYLOAD_TOO_LARGE', detail: 'Request too large.' },
      { status: 413 },
    );
  }
  const target = new URL(`/api/v1/dealer/commerce/${path}`, apiBaseUrl());
  target.search = new URL(request.url).search;
  try {
    const response = await fetch(target, {
      method: request.method,
      headers: forwarded,
      ...(body ? { body } : {}),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    const headers = new Headers({ 'cache-control': 'no-store, private' });
    for (const name of ['content-type', 'retry-after', 'x-request-id']) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(response.status === 204 ? null : await response.arrayBuffer(), {
      status: response.status,
      headers,
    });
  } catch {
    return Response.json(
      { code: 'COMMERCE_SERVICE_UNAVAILABLE', detail: 'Commerce service is unavailable.' },
      { status: 503 },
    );
  }
}

export const GET = proxy;
export const PATCH = proxy;
