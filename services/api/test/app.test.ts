import { afterEach, describe, expect, it } from 'vitest';

import { buildApi } from '../src/app.js';

const applications: Awaited<ReturnType<typeof buildApi>>[] = [];

async function createApi(readinessProbes?: Record<string, () => Promise<void>>) {
  const app = await buildApi({
    configuration: {
      environment: 'test',
      allowedOrigins: ['http://localhost:3000'],
      logLevel: 'error',
      trustProxy: false,
    },
    logger: false,
    ...(readinessProbes ? { readinessProbes } : {}),
  });
  applications.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
});

describe('API platform', () => {
  it('reports liveness and returns a request id', async () => {
    const app = await createApi();
    const response = await app.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'alive' });
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('fails readiness when a dependency probe fails', async () => {
    const app = await createApi({
      database: () => Promise.reject(new Error('database unavailable')),
    });
    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'unavailable',
      checks: { database: 'unavailable' },
    });
  });

  it('uses the standard problem shape for missing routes', async () => {
    const app = await createApi();
    const response = await app.inject({ method: 'GET', url: '/missing' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
  });
});
