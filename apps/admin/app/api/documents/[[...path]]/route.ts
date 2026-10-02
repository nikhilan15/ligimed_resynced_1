import { apiBaseUrl } from '../../../../lib/api-server';

async function proxy(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  const path = (await context.params).path?.join('/') ?? '';
  const uuid = '[0-9a-fA-F-]{36}';
  const allowed =
    (request.method === 'GET' &&
      (path === '' || new RegExp(`^uploads/${uuid}$|^(upload|kyc)/${uuid}/content$`).test(path))) ||
    (request.method === 'PUT' && path === 'policy') ||
    (request.method === 'POST' &&
      (path === 'reminders/run' || new RegExp(`^uploads/${uuid}/review$`).test(path)));
  if (!allowed) return new Response(null, { status: 404 });
  const headers = new Headers();
  for (const name of ['cookie', 'origin', 'content-type', 'x-csrf-token', 'sec-fetch-site']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const body = request.method !== 'GET' ? await request.arrayBuffer() : undefined;
  if (body && body.byteLength > 4096) return new Response(null, { status: 413 });
  try {
    const upstream = await fetch(
      `${apiBaseUrl()}/api/v1/admin/documents/${path}${request.method === 'GET' ? new URL(request.url).search : ''}`,
      {
        method: request.method,
        headers,
        ...(body ? { body } : {}),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      },
    );
    const outgoing = new Headers({
      'cache-control': 'no-store, private',
      'x-content-type-options': 'nosniff',
    });
    for (const name of [
      'content-type',
      'content-disposition',
      'content-security-policy',
      'x-request-id',
    ]) {
      const value = upstream.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: outgoing,
    });
  } catch {
    return Response.json(
      { detail: 'Document service is unavailable. Please try again.' },
      { status: 503 },
    );
  }
}
export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
