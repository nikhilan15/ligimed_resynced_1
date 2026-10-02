import { apiBaseUrl } from '../../../../lib/api-server';

const methods = new Map([
  ['bootstrap', 'GET'],
  ['session', 'GET'],
  ['otp/request', 'POST'],
  ['otp/verify', 'POST'],
  ['google/verify', 'POST'],
  ['select-pharmacy', 'POST'],
  ['logout', 'POST'],
]);

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const path = (await context.params).path.join('/');
  const headers = {
    'cache-control': 'no-store, private',
    'content-type': 'application/problem+json',
  };
  if (!methods.has(path)) return new Response(null, { status: 404, headers });
  if (methods.get(path) !== request.method) return new Response(null, { status: 405, headers });
  const forwarded = new Headers();
  for (const name of ['cookie', 'origin', 'content-type', 'x-csrf-token', 'sec-fetch-site']) {
    const value = request.headers.get(name);
    if (value) forwarded.set(name, value);
  }
  // Never forward arbitrary URLs, Authorization or user-supplied forwarded-IP headers.
  let body: string | undefined;
  if (request.method === 'POST') {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 4096) {
          await reader.cancel();
          return Response.json(
            { code: 'PAYLOAD_TOO_LARGE', detail: 'The request is too large.' },
            { status: 413, headers },
          );
        }
        chunks.push(chunk.value);
      }
    }
    body = Buffer.concat(chunks).toString('utf8');
  }
  try {
    const response = await fetch(`${apiBaseUrl()}/api/v1/pharmacy/auth/${path}`, {
      method: request.method,
      headers: forwarded,
      ...(body !== undefined ? { body } : {}),
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
      {
        code: 'AUTH_SERVICE_UNAVAILABLE',
        detail: 'Sign-in is temporarily unavailable. Please try again shortly.',
      },
      { status: 503, headers },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
