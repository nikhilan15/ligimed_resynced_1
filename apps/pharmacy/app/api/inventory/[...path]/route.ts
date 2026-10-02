import { apiBaseUrl } from '../../../../lib/api-server';

const uuid =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
const routes = [
  { pattern: /^batches$/, methods: new Set(['POST']) },
  { pattern: new RegExp(`^batches/${uuid}/adjustments$`), methods: new Set(['POST']) },
  { pattern: new RegExp(`^items/${uuid}/threshold$`), methods: new Set(['PATCH']) },
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
  const body = await request.arrayBuffer();
  if (body.byteLength > 8_192) {
    return Response.json(
      { code: 'PAYLOAD_TOO_LARGE', detail: 'Request too large.' },
      { status: 413 },
    );
  }
  try {
    const response = await fetch(new URL(`/api/v1/pharmacy/inventory/${path}`, apiBaseUrl()), {
      method: request.method,
      headers: forwarded,
      body,
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
      { code: 'INVENTORY_SERVICE_UNAVAILABLE', detail: 'Inventory service is unavailable.' },
      { status: 503 },
    );
  }
}

export const POST = proxy;
export const PATCH = proxy;
