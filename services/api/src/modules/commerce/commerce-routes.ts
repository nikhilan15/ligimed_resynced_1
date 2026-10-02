import { SessionRepository, type PrismaClient } from '@ligimed/database';
import {
  commerceOrderParamsSchema,
  commerceOrderQuerySchema,
  dealerOrderStatusInputSchema,
  pharmacyCartItemInputSchema,
  pharmacyCartItemParamsSchema,
  pharmacyCheckoutSchema,
  pharmacyOrderCancelSchema,
} from '@ligimed/validation';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { createBrowserAuthentication } from '../../platform/browser-authentication.js';
import { AppError } from '../../platform/errors.js';
import { CommerceService } from './commerce-service.js';

export interface CommerceOptions {
  database: PrismaClient;
  pharmacyCookieName: string;
  dealerCookieName: string;
  csrfSecret: string;
  allowedOrigins: string[];
}

function jsonRequired(request: FastifyRequest) {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
    throw new AppError(415, 'JSON_REQUIRED', 'Use application/json for this request.');
  }
}

function noStore(reply: { header(name: string, value: string): unknown }) {
  reply.header('cache-control', 'no-store, private');
  reply.header('pragma', 'no-cache');
}

export async function registerCommerce(app: FastifyInstance, options: CommerceOptions) {
  const sessions = new SessionRepository(options.database);
  const pharmacyGuard = createBrowserAuthentication({
    sessions,
    cookieName: options.pharmacyCookieName,
    csrfSecret: options.csrfSecret,
    allowedOrigins: options.allowedOrigins,
  });
  const dealerGuard = createBrowserAuthentication({
    sessions,
    cookieName: options.dealerCookieName,
    csrfSecret: options.csrfSecret,
    allowedOrigins: options.allowedOrigins,
  });
  const service = new CommerceService(options.database);

  await app.register(
    (routes) => {
      routes.addHook('onRequest', async (_request, reply) => {
        await Promise.resolve();
        noStore(reply);
      });
      routes.get('/cart', async (request) => {
        const session = await pharmacyGuard.authenticate(request);
        return service.cart(session.id, session.context);
      });
      routes.put('/cart/items/:listingId', { bodyLimit: 4_096 }, async (request) => {
        jsonRequired(request);
        const session = await pharmacyGuard.authenticate(request);
        const { listingId } = pharmacyCartItemParamsSchema.parse(request.params);
        const { quantity } = pharmacyCartItemInputSchema.parse(request.body);
        return service.setCartItem(session.id, session.context, listingId, quantity);
      });
      routes.delete('/cart/items/:listingId', async (request) => {
        const session = await pharmacyGuard.authenticate(request);
        const { listingId } = pharmacyCartItemParamsSchema.parse(request.params);
        return service.removeCartItem(session.id, session.context, listingId);
      });
      routes.post('/cart/checkout', { bodyLimit: 1_024 }, async (request, reply) => {
        jsonRequired(request);
        const input = pharmacyCheckoutSchema.parse(request.body);
        const session = await pharmacyGuard.authenticate(request);
        return reply.status(201).send(await service.checkout(session.id, session.context, input));
      });
      routes.get('/orders', async (request) => {
        const session = await pharmacyGuard.authenticate(request);
        return service.pharmacyOrders(
          session.id,
          session.context,
          commerceOrderQuerySchema.parse(request.query),
        );
      });
      routes.get('/orders/:orderId', async (request) => {
        const session = await pharmacyGuard.authenticate(request);
        const { orderId } = commerceOrderParamsSchema.parse(request.params);
        return service.pharmacyOrder(session.id, session.context, orderId);
      });
      routes.post('/orders/:orderId/cancel', { bodyLimit: 1_024 }, async (request) => {
        jsonRequired(request);
        pharmacyOrderCancelSchema.parse(request.body);
        const session = await pharmacyGuard.authenticate(request);
        const { orderId } = commerceOrderParamsSchema.parse(request.params);
        return service.cancelPharmacyOrder(session.id, session.context, orderId);
      });
    },
    { prefix: '/api/v1/pharmacy/commerce' },
  );

  await app.register(
    (routes) => {
      routes.addHook('onRequest', async (_request, reply) => {
        await Promise.resolve();
        noStore(reply);
      });
      routes.get('/orders', async (request) => {
        const session = await dealerGuard.authenticate(request);
        return service.dealerOrders(
          session.id,
          session.context,
          commerceOrderQuerySchema.parse(request.query),
        );
      });
      routes.get('/orders/:orderId', async (request) => {
        const session = await dealerGuard.authenticate(request);
        const { orderId } = commerceOrderParamsSchema.parse(request.params);
        return service.dealerOrder(session.id, session.context, orderId);
      });
      routes.patch('/orders/:orderId/status', { bodyLimit: 4_096 }, async (request) => {
        jsonRequired(request);
        const session = await dealerGuard.authenticate(request);
        const { orderId } = commerceOrderParamsSchema.parse(request.params);
        return service.updateDealerOrder(
          session.id,
          session.context,
          orderId,
          dealerOrderStatusInputSchema.parse(request.body),
        );
      });
    },
    { prefix: '/api/v1/dealer/commerce' },
  );
}
