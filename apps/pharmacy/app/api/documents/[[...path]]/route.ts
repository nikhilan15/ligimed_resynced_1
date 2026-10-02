import { apiBaseUrl } from '../../../../lib/api-server';

async function proxy(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  const path = (await context.params).path?.join('/') ?? '';
  const uuid = '[0-9a-fA-F-]{36}';
  const allowed =
    request.method === 'GET'
      ? path === '' ||
        path === 'links' ||
        new RegExp(`^uploads/${uuid}$|^(upload|kyc|invoice|order|payment)/${uuid}/content$`).test(
          path,
        )
      : request.method === 'POST' && path === 'uploads';
  if (!allowed) return new Response(null, { status: 404 });
  const headers = new Headers();
  for (const name of [
    'cookie',
    'origin',
    'content-type',
    'x-csrf-token',
    'sec-fetch-site',
    'x-file-name',
    'x-document-metadata',
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if ((headers.get('x-document-metadata')?.length ?? 0) > 8192)
    return new Response(null, { status: 413 });
  const length = Number(request.headers.get('content-length'));
  if (length > 5_242_880) return new Response(null, { status: 413 });
  const body = request.method === 'POST' ? await request.arrayBuffer() : undefined;
  if (body && body.byteLength > 5_242_880)
    return Response.json({ detail: 'Choose a file up to 5 MB.' }, { status: 413 });
  try {
    const upstream = await fetch(
      `${apiBaseUrl()}/api/v1/pharmacy/documents/${path}${request.method === 'GET' ? new URL(request.url).search : ''}`,
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
