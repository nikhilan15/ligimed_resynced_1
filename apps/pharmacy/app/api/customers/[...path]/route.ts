import { apiBaseUrl } from '../../../../lib/api-server';

const uuid =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const path = (await context.params).path.join('/');
  const create = path === 'create' && request.method === 'POST';
  const update = new RegExp(`^${uuid}$`).test(path) && request.method === 'PATCH';
  const stateChange =
    new RegExp(`^${uuid}/(archive|restore)$`).test(path) && request.method === 'POST';
  if (!create && !update && !stateChange) return new Response(null, { status: 404 });
  const headers = new Headers();
  for (const name of ['cookie', 'origin', 'content-type', 'x-csrf-token', 'sec-fetch-site']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > 4_096)
    return Response.json(
      { code: 'PAYLOAD_TOO_LARGE', detail: 'Request too large.' },
      { status: 413 },
    );
  try {
    const response = await fetch(
      `${apiBaseUrl()}/api/v1/pharmacy/customers${create ? '' : `/${path}`}`,
      {
        method: request.method,
        headers,
        body,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      },
    );
    const outgoing = new Headers({ 'cache-control': 'no-store, private' });
    for (const name of ['content-type', 'x-request-id']) {
      const value = response.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    return new Response(response.status === 204 ? null : await response.arrayBuffer(), {
      status: response.status,
      headers: outgoing,
    });
  } catch {
    return Response.json(
      { code: 'CUSTOMER_SERVICE_UNAVAILABLE', detail: 'Customer service is unavailable.' },
      { status: 503 },
    );
  }
}

export const POST = proxy;
export const PATCH = proxy;
