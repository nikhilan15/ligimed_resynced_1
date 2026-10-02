import { SessionRepository, type PrismaClient } from '@ligimed/database';
import type { FastifyInstance } from 'fastify';

import { createBrowserAuthentication } from '../../platform/browser-authentication.js';
import { PharmacyDashboardService } from './pharmacy-dashboard-service.js';

export interface PharmacyDashboardOptions {
  database: PrismaClient;
  cookieName: string;
  csrfSecret: string;
  allowedOrigins: string[];
}

export async function registerPharmacyDashboard(
  app: FastifyInstance,
  options: PharmacyDashboardOptions,
) {
  const guard = createBrowserAuthentication({
    sessions: new SessionRepository(options.database),
    cookieName: options.cookieName,
    csrfSecret: options.csrfSecret,
    allowedOrigins: options.allowedOrigins,
  });
  const service = new PharmacyDashboardService(options.database);

  await app.register(
    (routes) => {
      routes.addHook('onRequest', async (_request, reply) => {
        await Promise.resolve();
        void reply.header('cache-control', 'no-store, private').header('pragma', 'no-cache');
      });
      routes.get('/', async (request) => {
        const session = await guard.authenticate(request);
        return service.getDashboard(session.id, session.context);
      });
    },
    { prefix: '/api/v1/pharmacy/dashboard' },
  );
}
