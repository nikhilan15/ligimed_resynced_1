import { SessionRepository, type PrismaClient } from '@ligimed/database';
import {
  dealerCatalogueListingInputSchema,
  dealerCatalogueListingParamsSchema,
  dealerCatalogueListingUpdateSchema,
  dealerCatalogueQuerySchema,
} from '@ligimed/validation';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { createBrowserAuthentication } from '../../platform/browser-authentication.js';
import { AppError } from '../../platform/errors.js';
import { DealerCatalogueService } from './dealer-catalogue-service.js';

export interface DealerCatalogueOptions {
  database: PrismaClient;
  cookieName: string;
  csrfSecret: string;
  allowedOrigins: string[];
}

function jsonRequired(request: FastifyRequest) {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
    throw new AppError(415, 'JSON_REQUIRED', 'Use application/json for this request.');
  }
}

export async function registerDealerCatalogue(
  app: FastifyInstance,
  options: DealerCatalogueOptions,
) {
  const guard = createBrowserAuthentication({
    sessions: new SessionRepository(options.database),
    cookieName: options.cookieName,
    csrfSecret: options.csrfSecret,
    allowedOrigins: options.allowedOrigins,
  });
  const service = new DealerCatalogueService(options.database);

  await app.register(
    (routes) => {
      routes.addHook('onRequest', async (_request, reply) => {
        await Promise.resolve();
        void reply.header('cache-control', 'no-store, private').header('pragma', 'no-cache');
      });

      routes.get('/listings', async (request) => {
        const session = await guard.authenticate(request);
        const query = dealerCatalogueQuerySchema.parse(request.query);
        return service.list(session.id, session.context, query);
      });

      routes.get('/listings/:listingId', async (request) => {
        const session = await guard.authenticate(request);
        const { listingId } = dealerCatalogueListingParamsSchema.parse(request.params);
        return service.detail(session.id, session.context, listingId);
      });

      routes.post('/listings', { bodyLimit: 32_768 }, async (request, reply) => {
        jsonRequired(request);
        const session = await guard.authenticate(request);
        const input = dealerCatalogueListingInputSchema.parse(request.body);
        return reply.status(201).send(await service.create(session.id, session.context, input));
      });

      routes.patch('/listings/:listingId', { bodyLimit: 8_192 }, async (request) => {
        jsonRequired(request);
        const session = await guard.authenticate(request);
        const { listingId } = dealerCatalogueListingParamsSchema.parse(request.params);
        const input = dealerCatalogueListingUpdateSchema.parse(request.body);
        return service.update(session.id, session.context, listingId, input);
      });
    },
    { prefix: '/api/v1/dealer/catalogue' },
  );
}
