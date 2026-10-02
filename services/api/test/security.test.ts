import { Writable } from 'node:stream';

import type { RequestContext } from '@ligimed/types';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApi, type ApiOptions } from '../src/app.js';
import {
  createBrowserAuthentication,
  sessionCookieOptions,
} from '../src/platform/browser-authentication.js';

const applications: Awaited<ReturnType<typeof buildApi>>[] = [];
const configuration: ApiOptions['configuration'] = {
  environment: 'test',
  allowedOrigins: ['https://app.example.com'],
  logLevel: 'info',
  trustProxy: false,
};
const token = 'a'.repeat(43);
const context: RequestContext = {
  userId: 'user-1',
  organizationId: 'organization-a',
  membershipId: 'membership-a',
  requestId: 'request',
  permissions: new Set(['organization.read']),
};
const browser = createBrowserAuthentication({
  sessions: {
    resolve: (value, requestId) =>
      Promise.resolve(
        value === token
          ? {
              id: 'session-a',
              context: { ...context, requestId },
              expiresAt: new Date(Date.now() + 60_000),
            }
          : null,
      ),
  },
  cookieName: 'ligimed_session',
  csrfSecret: 'test-only-csrf-secret-of-at-least-32-bytes',
  allowedOrigins: configuration.allowedOrigins,
});

async function api(options: Partial<Omit<ApiOptions, 'configuration'>> = {}) {
  const app = await buildApi({ configuration, logger: false, ...options });
  applications.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
});

async function authenticatedApi() {
  return api({
    registerRoutes: (app) => {
      app.route({
        method: ['GET', 'HEAD', 'POST', 'OPTIONS'],
        url: '/test/protected',
        handler: async (request) => {
          const session = await browser.authenticate(request);
          return { organizationId: session.context.organizationId };
        },
      });
      app.get('/test/cookie', (_request, reply) =>
        reply
          .setCookie(
            'ligimed_session',
            token,
            sessionCookieOptions('production', new Date('2030-01-01')),
          )
          .send({ status: 'issued' }),
      );
    },
  });
}

describe('browser session transport security', () => {
  it('rejects missing or invalid sessions even with an Authorization header', async () => {
    const app = await authenticatedApi();
    for (const cookie of ['', 'ligimed_session=invalid', `ligimed_session=${'b'.repeat(43)}`]) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/test/protected',
            headers: { cookie, authorization: 'Bearer unverified' },
          })
        ).statusCode,
      ).toBe(401);
    }
  });

  it('requires a trusted Origin and session-bound CSRF token for mutations', async () => {
    const app = await authenticatedApi();
    const headers = {
      cookie: `ligimed_session=${token}`,
      origin: 'https://app.example.com',
      'x-csrf-token': browser.csrfToken(token),
    };
    expect((await app.inject({ method: 'POST', url: '/test/protected', headers })).statusCode).toBe(
      200,
    );
    const rejected = [
      { cookie: headers.cookie, 'x-csrf-token': headers['x-csrf-token'] },
      { ...headers, origin: 'https://attacker.example.com' },
      { cookie: headers.cookie, origin: headers.origin },
      { ...headers, 'x-csrf-token': browser.csrfToken('b'.repeat(43)) },
      { ...headers, 'x-csrf-token': 'short', authorization: 'Bearer unverified' },
    ];
    for (const candidate of rejected) {
      const response = await app.inject({
        method: 'POST',
        url: '/test/protected',
        headers: candidate,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'CSRF_REJECTED' });
    }
  });

  it('permits safe methods without a CSRF token while still requiring authentication', async () => {
    const app = await authenticatedApi();
    for (const method of ['GET', 'HEAD'] as const) {
      expect(
        (
          await app.inject({
            method,
            url: '/test/protected',
            headers: { cookie: `ligimed_session=${token}` },
          })
        ).statusCode,
      ).toBe(200);
    }
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/test/protected',
      headers: {
        origin: 'https://app.example.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-csrf-token',
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('https://app.example.com');
  });

  it('uses Secure, HttpOnly, SameSite and host-only production cookies', async () => {
    const response = await (await authenticatedApi()).inject('/test/cookie');
    const cookie = String(response.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Domain=');
    expect(sessionCookieOptions('development', new Date()).secure).toBe(false);
  });
});

describe('API platform security', () => {
  it('permits only allowlisted credentialed browser origins', async () => {
    const app = await api();
    const trusted = await app.inject({
      url: '/health/live',
      headers: { origin: 'https://app.example.com' },
    });
    expect(trusted.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(trusted.headers['access-control-allow-credentials']).toBe('true');
    const rejected = await app.inject({
      url: '/health/live',
      headers: { origin: 'https://attacker.example.com' },
    });
    expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('generates request IDs on the server and adds security headers', async () => {
    const response = await (
      await api()
    ).inject({ url: '/health/live', headers: { 'x-request-id': 'client-controlled' } });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers['x-request-id']).not.toBe('client-controlled');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('returns 429 with retry information instead of turning rate limits into 500s', async () => {
    const app = await api();
    for (let request = 0; request < 120; request += 1) await app.inject('/health/live');
    const response = await app.inject('/health/live');
    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(response.headers['retry-after']).toBeTruthy();
  });

  it('returns safe malformed JSON and payload-size errors', async () => {
    const app = await api({
      registerRoutes: (instance) => {
        instance.post('/test/body', () => ({ accepted: true }));
      },
    });
    const malformed = await app.inject({
      method: 'POST',
      url: '/test/body',
      headers: { 'content-type': 'application/json' },
      payload: '{"secret":"SENTINEL_SECRET"',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).not.toContain('SENTINEL_SECRET');
    expect(malformed.headers['content-type']).toContain('application/problem+json');
    const oversized = await app.inject({
      method: 'POST',
      url: '/test/body',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ value: 'x'.repeat(1_048_576) }),
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json()).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('keeps credential headers, URL queries and raw exceptions out of logs and responses', async () => {
    const entries: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        entries.push(chunk.toString());
        done();
      },
    });
    const app = await api({
      logger: { stream },
      registerRoutes: (instance) => {
        instance.get('/test/error', () => {
          throw new Error('SENTINEL_SECRET');
        });
      },
    });
    const response = await app.inject({
      url: '/test/error?token=SENTINEL_SECRET',
      headers: {
        cookie: 'secret=SENTINEL_SECRET',
        authorization: 'Bearer SENTINEL_SECRET',
        'x-request-id': 'SENTINEL_SECRET',
      },
    });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('SENTINEL_SECRET');
    expect(entries.join('')).not.toContain('SENTINEL_SECRET');
    expect(entries.join('')).toContain('Unhandled request error');
  });

  it('closes dependencies through the API lifecycle', async () => {
    let closed = false;
    const app = await api({
      onClose: () => {
        closed = true;
        return Promise.resolve();
      },
    });
    await app.close();
    expect(closed).toBe(true);
  });
});
