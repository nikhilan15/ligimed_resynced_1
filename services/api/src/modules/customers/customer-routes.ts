import { SessionRepository, type PrismaClient } from '@ligimed/database';
import {
  customerIdParamsSchema,
  customerInputSchema,
  customerListQuerySchema,
} from '@ligimed/validation';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { createBrowserAuthentication } from '../../platform/browser-authentication.js';
import { AppError } from '../../platform/errors.js';
import { CustomerService } from './customer-service.js';

export interface CustomerOptions {
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

export async function registerCustomers(app: FastifyInstance, options: CustomerOptions) {
  const guard = createBrowserAuthentication({
    sessions: new SessionRepository(options.database),
    cookieName: options.cookieName,
    csrfSecret: options.csrfSecret,
    allowedOrigins: options.allowedOrigins,
  });
  const service = new CustomerService(options.database);
  await app.register(
    (routes) => {
      routes.addHook('onRequest', async (_request, reply) => {
        await Promise.resolve();
        reply.header('cache-control', 'no-store, private');
      });
      routes.get('/', async (request) => {
        const session = await guard.authenticate(request);
        return service.list(
          session.id,
          session.context,
          customerListQuerySchema.parse(request.query),
        );
      });
      routes.post('/', { bodyLimit: 4_096 }, async (request, reply) => {
        jsonRequired(request);
        const session = await guard.authenticate(request);
        return reply
          .status(201)
          .send(
            await service.create(
              session.id,
              session.context,
              customerInputSchema.parse(request.body),
            ),
          );
      });
      routes.patch('/:customerId', { bodyLimit: 4_096 }, async (request) => {
        jsonRequired(request);
        const session = await guard.authenticate(request);
        const { customerId } = customerIdParamsSchema.parse(request.params);
        return service.update(
          session.id,
          session.context,
          customerId,
          customerInputSchema.parse(request.body),
        );
      });
      routes.post('/:customerId/archive', { bodyLimit: 1_024 }, async (request, reply) => {
        jsonRequired(request);
        const session = await guard.authenticate(request);
        const { customerId } = customerIdParamsSchema.parse(request.params);
        await service.archive(session.id, session.context, customerId);
        return reply.status(204).send();
      });
      routes.post('/:customerId/restore', { bodyLimit: 1_024 }, async (request, reply) => {
        jsonRequired(request);
        const session = await guard.authenticate(request);
        const { customerId } = customerIdParamsSchema.parse(request.params);
        await service.restore(session.id, session.context, customerId);
        return reply.status(204).send();
      });
    },
    { prefix: '/api/v1/pharmacy/customers' },
  );
}
