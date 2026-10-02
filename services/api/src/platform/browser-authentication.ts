import { createHmac, timingSafeEqual } from 'node:crypto';

import type { CookieSerializeOptions } from '@fastify/cookie';
import type { RequestContext } from '@ligimed/types';
import type { FastifyRequest } from 'fastify';

import { AppError } from './errors.js';

export interface ResolvedSession {
  id: string;
  context: RequestContext;
  expiresAt: Date;
}

export interface SessionResolver {
  resolve(token: string, requestId: string): Promise<ResolvedSession | null>;
}

export interface BrowserAuthenticationOptions {
  sessions: SessionResolver;
  cookieName: string;
  csrfSecret: string;
  allowedOrigins: readonly string[];
}

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function sessionCookieOptions(
  environment: 'development' | 'test' | 'production',
  expiresAt: Date,
): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: environment === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  };
}

/** Only return CSRF tokens to an authenticated browser on a non-cacheable response. */
export function createBrowserAuthentication(options: BrowserAuthenticationOptions) {
  if (Buffer.byteLength(options.csrfSecret, 'utf8') < 32) {
    throw new Error('CSRF_SECRET must contain at least 32 bytes');
  }
  const origins = new Set(options.allowedOrigins);
  const csrfToken = (sessionToken: string): string =>
    createHmac('sha256', options.csrfSecret)
      .update(`ligimed:csrf:v1:${sessionToken}`)
      .digest('base64url');

  function verifyCsrf(request: FastifyRequest, token: string): void {
    const origin = request.headers.origin;
    const submitted = request.headers['x-csrf-token'];
    if (
      typeof origin !== 'string' ||
      !origins.has(origin) ||
      !tokenPattern.test(token) ||
      typeof submitted !== 'string' ||
      !tokenPattern.test(submitted) ||
      !timingSafeEqual(Buffer.from(submitted), Buffer.from(csrfToken(token)))
    ) {
      throw new AppError(403, 'CSRF_REJECTED', 'Request origin or CSRF token is invalid', 'csrf');
    }
  }

  async function authenticate(request: FastifyRequest): Promise<ResolvedSession> {
    const token = request.cookies[options.cookieName];
    if (!token || !tokenPattern.test(token)) {
      throw new AppError(
        401,
        'AUTHENTICATION_REQUIRED',
        'A valid session is required',
        'authentication',
      );
    }
    const session = await options.sessions.resolve(token, request.id);
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      throw new AppError(
        401,
        'AUTHENTICATION_REQUIRED',
        'A valid session is required',
        'authentication',
      );
    }
    if (!safeMethods.has(request.method)) {
      verifyCsrf(request, token);
    }
    return session;
  }

  return { authenticate, csrfToken, verifyCsrf };
}
