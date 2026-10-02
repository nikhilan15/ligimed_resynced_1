import { apiBaseUrl } from '../../../../lib/api-server';

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const path = (await context.params).path.join('/');
  const uuid =
    '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
  const draft = new RegExp(`^drafts/${uuid}$`).test(path);
  const customerHistory = new RegExp(`^customers/${uuid}/history$`).test(path);
  const paymentEntry = new RegExp(`^${uuid}/payment-entries$`).test(path);
  const allowed =
    (request.method === 'GET' &&
      (path === 'options' || path === 'drafts' || draft || customerHistory)) ||
    (request.method === 'POST' &&
      (['retail-sales', 'dealer-purchases', 'drafts'].includes(path) || paymentEntry)) ||
    (draft && ['PUT', 'DELETE'].includes(request.method));
  if (!allowed) return new Response(null, { status: 404 });
  const headers = new Headers();
  for (const name of ['cookie', 'origin', 'content-type', 'x-csrf-token', 'sec-fetch-site']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const body = ['POST', 'PUT'].includes(request.method) ? await request.arrayBuffer() : undefined;
  if (body && body.byteLength > 16_384)
    return Response.json(
      { code: 'PAYLOAD_TOO_LARGE', detail: 'Request too large.' },
      { status: 413 },
    );
  try {
    const upstream = await fetch(
      `${apiBaseUrl()}/api/v1/pharmacy/billing/${path}${request.method === 'GET' ? new URL(request.url).search : ''}`,
      {
        method: request.method,
        headers,
        ...(body ? { body } : {}),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      },
    );
    const outgoing = new Headers({ 'cache-control': 'no-store, private' });
    for (const name of ['content-type', 'x-request-id']) {
      const value = upstream.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    return new Response(upstream.status === 204 ? null : await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: outgoing,
    });
  } catch {
    return Response.json(
      { code: 'BILLING_SERVICE_UNAVAILABLE', detail: 'Billing service is unavailable.' },
      { status: 503 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
