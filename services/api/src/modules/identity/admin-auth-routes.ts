import { createSessionToken } from '@ligimed/auth';
import {
  OtpRateLimitError,
  OtpRepository,
  SessionRepository,
  type PrismaClient,
} from '@ligimed/database';
import { pharmacyOtpVerifySchema } from '@ligimed/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  createBrowserAuthentication,
  sessionCookieOptions,
} from '../../platform/browser-authentication.js';
import { AppError } from '../../platform/errors.js';
import { AdminAuthService } from './admin-auth-service.js';
import { AuthRateLimiter } from './auth-rate-limiter.js';
import { GoogleAuthService } from './google-auth-service.js';
import { googleNonce, verifyGoogleCredential } from './google-identity.js';
import type { OtpProvider } from './otp-provider.js';

export interface AdminAuthOptions {
  database: PrismaClient;
  provider: OtpProvider;
  environment: 'development' | 'test' | 'production';
  cookieName: string;
  csrfSecret: string;
  otpSecret: string;
  allowedOrigins: string[];
  ttlSeconds: number;
  developmentDelivery: boolean;
  googleClientId?: string | undefined;
}

export async function registerAdminAuth(app: FastifyInstance, options: AdminAuthOptions) {
  const sessions = new SessionRepository(options.database);
  const guard = createBrowserAuthentication({
    sessions,
    cookieName: options.cookieName,
    csrfSecret: options.csrfSecret,
    allowedOrigins: options.allowedOrigins,
  });
  const service = new AdminAuthService(
    options.database,
    new OtpRepository(options.database, options.otpSecret),
    sessions,
    options.provider,
    options.ttlSeconds,
  );
  const limiter = new AuthRateLimiter(options.database, options.otpSecret);
  const google = new GoogleAuthService(options.database, sessions, options.ttlSeconds);
  const preAuthCookie = `${options.cookieName}_preauth`;
  const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

  await app.register(
    async (routes) => {
      await Promise.resolve();
      routes.addHook('onRequest', async (_request, reply) => {
        await Promise.resolve();
        void reply.header('cache-control', 'no-store, private').header('pragma', 'no-cache');
      });
      routes.addHook('preValidation', async (request) => {
        await Promise.resolve();
        if (
          request.method === 'POST' &&
          request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json'
        ) {
          throw new AppError(415, 'JSON_REQUIRED', 'Use application/json for this request.');
        }
      });
      const preAuth = (request: FastifyRequest) => {
        const token = request.cookies[preAuthCookie] ?? '';
        guard.verifyCsrf(request, token);
        return token;
      };
      const finish = (reply: FastifyReply, session: { token: string; expiresAt: Date }) => {
        void reply.setCookie(
          options.cookieName,
          session.token,
          sessionCookieOptions(options.environment, session.expiresAt),
        );
        void reply.clearCookie(
          preAuthCookie,
          sessionCookieOptions(options.environment, new Date(0)),
        );
        return { status: 'AUTHENTICATED' as const };
      };

      routes.get('/bootstrap', async (request, reply) => {
        const origin = request.headers.origin;
        if (
          (origin && !options.allowedOrigins.includes(origin)) ||
          request.headers['sec-fetch-site'] === 'cross-site'
        ) {
          throw new AppError(403, 'CSRF_REJECTED', 'Request origin is invalid.');
        }
        const previous = request.cookies[preAuthCookie];
        const token = previous && tokenPattern.test(previous) ? previous : createSessionToken();
        reply.setCookie(
          preAuthCookie,
          token,
          sessionCookieOptions(options.environment, new Date(Date.now() + 15 * 60_000)),
        );
        return {
          csrfToken: guard.csrfToken(token),
          developmentDelivery: options.developmentDelivery,
          googleClientId: options.googleClientId ?? null,
          googleNonce: googleNonce(token, options.csrfSecret),
        };
      });

      routes.post('/google/verify', { bodyLimit: 4096 }, async (request, reply) => {
        const token = preAuth(request);
        await limiter.consume(request.ip, 'verify');
        const body = request.body as Record<string, unknown> | null;
        if (!body || typeof body.credential !== 'string' || body.credential.length > 3500) {
          throw new AppError(400, 'GOOGLE_REQUEST_INVALID', 'The sign-in request is invalid.');
        }
        const identity = await verifyGoogleCredential(
          body.credential,
          googleNonce(token, options.csrfSecret),
          options.googleClientId,
        );
        return finish(
          reply,
          await google.admin(identity, request.id, request.cookies[options.cookieName]),
        );
      });

      routes.post('/otp/request', { bodyLimit: 4096 }, async (request, reply) => {
        if (options.googleClientId) throw new AppError(410, 'OTP_RETIRED', 'Use Google Sign-In.');
        const token = preAuth(request);
        await limiter.consume(request.ip, 'request');
        try {
          return reply.status(202).send(await service.requestCode(request.body, token));
        } catch (error) {
          if (error instanceof OtpRateLimitError) {
            void reply.header('retry-after', '60');
            throw new AppError(429, error.code, 'Please wait before requesting another code.');
          }
          throw error;
        }
      });
      routes.post('/otp/verify', { bodyLimit: 4096 }, async (request, reply) => {
        if (options.googleClientId) throw new AppError(410, 'OTP_RETIRED', 'Use Google Sign-In.');
        const token = preAuth(request);
        await limiter.consume(request.ip, 'verify');
        const input = pharmacyOtpVerifySchema.parse(request.body);
        return finish(
          reply,
          await service.verifyCode(input, token, request.id, request.cookies[options.cookieName]),
        );
      });
      routes.get('/session', async (request) => {
        const session = await guard.authenticate(request);
        return {
          ...(await service.account(session.id, session.context)),
          csrfToken: guard.csrfToken(request.cookies[options.cookieName]!),
        };
      });
      routes.post('/logout', { bodyLimit: 4096 }, async (request, reply) => {
        const session = await guard.authenticate(request);
        await service.account(session.id, session.context);
        await service.logout(session.id, session.context);
        void reply.clearCookie(
          options.cookieName,
          sessionCookieOptions(options.environment, new Date(0)),
        );
        return reply.status(204).send();
      });
    },
    { prefix: '/api/v1/admin/auth' },
  );
}
