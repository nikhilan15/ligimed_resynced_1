import { apiBaseUrl } from '../../../../lib/api-server';

const listingPath =
  /^listings(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})?$/i;

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const path = (await context.params).path.join('/');
  if (!listingPath.test(path)) return new Response(null, { status: 404 });
  const allowed = path === 'listings' ? new Set(['GET', 'POST']) : new Set(['GET', 'PATCH']);
  if (!allowed.has(request.method)) return new Response(null, { status: 405 });
  const forwarded = new Headers();
  for (const name of ['cookie', 'origin', 'content-type', 'x-csrf-token', 'sec-fetch-site']) {
    const value = request.headers.get(name);
    if (value) forwarded.set(name, value);
  }
  const body = ['POST', 'PATCH'].includes(request.method) ? await request.arrayBuffer() : undefined;
  if (body && body.byteLength > 32_768) {
    return Response.json(
      { code: 'PAYLOAD_TOO_LARGE', detail: 'Request too large.' },
      { status: 413 },
    );
  }
  const source = new URL(request.url);
  const target = new URL(`/api/v1/dealer/catalogue/${path}`, apiBaseUrl());
  target.search = source.search;
  try {
    const response = await fetch(target, {
      method: request.method,
      headers: forwarded,
      ...(body ? { body } : {}),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    const outgoing = new Headers({ 'cache-control': 'no-store, private' });
    for (const name of ['content-type', 'retry-after', 'x-request-id']) {
      const value = response.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    return new Response(response.status === 204 ? null : await response.arrayBuffer(), {
      status: response.status,
      headers: outgoing,
    });
  } catch {
    return Response.json(
      { code: 'CATALOGUE_SERVICE_UNAVAILABLE', detail: 'Catalogue service is unavailable.' },
      { status: 503 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
