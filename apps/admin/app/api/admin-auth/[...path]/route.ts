import { apiBaseUrl } from '../../../../lib/api-server';

const methods = new Map([
  ['bootstrap', 'GET'],
  ['session', 'GET'],
  ['otp/request', 'POST'],
  ['otp/verify', 'POST'],
  ['google/verify', 'POST'],
  ['logout', 'POST'],
]);

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const path = (await context.params).path.join('/');
  const errorHeaders = {
    'cache-control': 'no-store, private',
    'content-type': 'application/problem+json',
  };
  if (!methods.has(path)) return new Response(null, { status: 404, headers: errorHeaders });
  if (methods.get(path) !== request.method)
    return new Response(null, { status: 405, headers: errorHeaders });
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
  try {
    const response = await fetch(`${apiBaseUrl()}/api/v1/admin/auth/${path}`, {
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
    for (const cookie of response.headers.getSetCookie()) outgoing.append('set-cookie', cookie);
    return new Response(response.status === 204 ? null : await response.arrayBuffer(), {
      status: response.status,
      headers: outgoing,
    });
  } catch {
    return Response.json(
      { code: 'ADMIN_AUTH_UNAVAILABLE', detail: 'Admin sign-in is temporarily unavailable.' },
      { status: 503, headers: errorHeaders },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
