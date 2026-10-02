import { SessionRepository, type PrismaClient } from '@ligimed/database';
import {
  inventoryAdjustmentInputSchema,
  inventoryBatchInputSchema,
  inventoryBatchParamsSchema,
  inventoryItemParamsSchema,
  inventoryProductQuerySchema,
  inventoryQuerySchema,
  inventoryThresholdInputSchema,
} from '@ligimed/validation';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { createBrowserAuthentication } from '../../platform/browser-authentication.js';
import { AppError } from '../../platform/errors.js';
import { InventoryService } from './inventory-service.js';

export interface InventoryOptions {
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

export async function registerInventory(app: FastifyInstance, options: InventoryOptions) {
  const guard = createBrowserAuthentication({
    sessions: new SessionRepository(options.database),
    cookieName: options.cookieName,
    csrfSecret: options.csrfSecret,
    allowedOrigins: options.allowedOrigins,
  });
  const service = new InventoryService(options.database);
  await app.register(
    (routes) => {
      routes.addHook('onRequest', async (_request, reply) => {
        await Promise.resolve();
        reply.header('cache-control', 'no-store, private');
      });
      routes.get('/', async (request) => {
        const session = await guard.authenticate(request);
        return service.list(session.id, session.context, inventoryQuerySchema.parse(request.query));
      });
      routes.get('/products', async (request) => {
        const session = await guard.authenticate(request);
        const query = inventoryProductQuerySchema.parse(request.query);
        return service.products(session.id, session.context, query.q, query.limit);
      });
      routes.post('/batches', { bodyLimit: 8_192 }, async (request, reply) => {
        jsonRequired(request);
        const session = await guard.authenticate(request);
        return reply
          .status(201)
          .send(
            await service.addBatch(
              session.id,
              session.context,
              inventoryBatchInputSchema.parse(request.body),
            ),
          );
      });
      routes.post('/batches/:batchId/adjustments', { bodyLimit: 4_096 }, async (request) => {
        jsonRequired(request);
        const session = await guard.authenticate(request);
        const { batchId } = inventoryBatchParamsSchema.parse(request.params);
        return service.adjustBatch(
          session.id,
          session.context,
          batchId,
          inventoryAdjustmentInputSchema.parse(request.body),
        );
      });
      routes.patch('/items/:itemId/threshold', { bodyLimit: 1_024 }, async (request) => {
        jsonRequired(request);
        const session = await guard.authenticate(request);
        const { itemId } = inventoryItemParamsSchema.parse(request.params);
        const { reorderLevel } = inventoryThresholdInputSchema.parse(request.body);
        return service.threshold(session.id, session.context, itemId, reorderLevel);
      });
    },
    { prefix: '/api/v1/pharmacy/inventory' },
  );
}
