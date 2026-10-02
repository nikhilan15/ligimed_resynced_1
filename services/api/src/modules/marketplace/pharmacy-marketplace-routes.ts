import { SessionRepository, type PrismaClient } from '@ligimed/database';
import {
  pharmacyCatalogueQuerySchema,
  pharmacyCatalogueListingParamsSchema,
  pharmacyDealerIdSchema,
  pharmacyMarketplaceQuerySchema,
} from '@ligimed/validation';
import type { FastifyInstance } from 'fastify';

import { createBrowserAuthentication } from '../../platform/browser-authentication.js';
import { PharmacyMarketplaceService } from './pharmacy-marketplace-service.js';

export interface PharmacyMarketplaceOptions {
  database: PrismaClient;
  cookieName: string;
  csrfSecret: string;
  allowedOrigins: string[];
}

export async function registerPharmacyMarketplace(
  app: FastifyInstance,
  options: PharmacyMarketplaceOptions,
) {
  const guard = createBrowserAuthentication({
    sessions: new SessionRepository(options.database),
    cookieName: options.cookieName,
    csrfSecret: options.csrfSecret,
    allowedOrigins: options.allowedOrigins,
  });
  const service = new PharmacyMarketplaceService(options.database);

  await app.register(
    (routes) => {
      routes.addHook('onRequest', async (_request, reply) => {
        await Promise.resolve();
        void reply.header('cache-control', 'no-store, private').header('pragma', 'no-cache');
      });
      routes.get('/dealers', async (request) => {
        const session = await guard.authenticate(request);
        const query = pharmacyMarketplaceQuerySchema.parse(request.query);
        return service.listDealers(session.id, session.context, query);
      });
      routes.get('/dealers/:dealerId', async (request) => {
        const session = await guard.authenticate(request);
        const { dealerId } = pharmacyDealerIdSchema.parse(request.params);
        return service.dealerDetail(session.id, session.context, dealerId);
      });
      routes.get('/dealers/:dealerId/catalogue', async (request) => {
        const session = await guard.authenticate(request);
        const { dealerId } = pharmacyDealerIdSchema.parse(request.params);
        const query = pharmacyCatalogueQuerySchema.parse(request.query);
        return service.dealerCatalogue(session.id, session.context, dealerId, query);
      });
      routes.get('/dealers/:dealerId/catalogue/:listingId', async (request) => {
        const session = await guard.authenticate(request);
        const { dealerId, listingId } = pharmacyCatalogueListingParamsSchema.parse(request.params);
        return service.dealerCatalogueListing(session.id, session.context, dealerId, listingId);
      });
    },
    { prefix: '/api/v1/pharmacy/marketplace' },
  );
}
