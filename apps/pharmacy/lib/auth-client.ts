export class AuthRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function authRequest(
  path: string,
  body?: unknown,
  csrfToken?: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`/api/auth/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error('Unable to connect. Check your connection and try again.');
  }
  const data: unknown = response.status === 204 ? undefined : await response.json();
  if (!response.ok) {
    const problem = data as { code?: string; detail?: string } | undefined;
    throw new AuthRequestError(
      response.status,
      problem?.code ?? 'REQUEST_FAILED',
      problem?.detail ?? 'Something went wrong. Please try again.',
    );
  }
  return data;
}
