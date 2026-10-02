import { SessionRepository, type PrismaClient } from '@ligimed/database';
import {
  billingOptionsQuerySchema,
  invoiceIdParamsSchema,
  invoicePaymentEntryInputSchema,
  invoiceListQuerySchema,
  purchaseInvoiceInputSchema,
  retailDraftIdParamsSchema,
  retailDraftInputSchema,
  retailSaleInputSchema,
  customerIdParamsSchema,
} from '@ligimed/validation';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { createBrowserAuthentication } from '../../platform/browser-authentication.js';
import { AppError } from '../../platform/errors.js';
import { BillingService } from './billing-service.js';

export interface BillingOptions {
  database: PrismaClient;
  cookieName: string;
  csrfSecret: string;
  allowedOrigins: string[];
}

function requireJson(request: FastifyRequest) {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json')
    throw new AppError(415, 'JSON_REQUIRED', 'Use application/json for this request.');
}

export async function registerBilling(app: FastifyInstance, options: BillingOptions) {
  const guard = createBrowserAuthentication({
    sessions: new SessionRepository(options.database),
    cookieName: options.cookieName,
    csrfSecret: options.csrfSecret,
    allowedOrigins: options.allowedOrigins,
  });
  const service = new BillingService(options.database);
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
          invoiceListQuerySchema.parse(request.query),
        );
      });
      routes.get('/options', async (request) => {
        const session = await guard.authenticate(request);
        return service.options(
          session.id,
          session.context,
          billingOptionsQuerySchema.parse(request.query),
        );
      });
      routes.get('/drafts', async (request) => {
        const session = await guard.authenticate(request);
        return service.listDrafts(session.id, session.context);
      });
      routes.post('/drafts', { bodyLimit: 16_384 }, async (request, reply) => {
        requireJson(request);
        const session = await guard.authenticate(request);
        return reply
          .status(201)
          .send(
            await service.saveDraft(
              session.id,
              session.context,
              retailDraftInputSchema.parse(request.body),
            ),
          );
      });
      routes.get('/drafts/:draftId', async (request) => {
        const session = await guard.authenticate(request);
        const { draftId } = retailDraftIdParamsSchema.parse(request.params);
        return service.getDraft(session.id, session.context, draftId);
      });
      routes.put('/drafts/:draftId', { bodyLimit: 16_384 }, async (request) => {
        requireJson(request);
        const session = await guard.authenticate(request);
        const { draftId } = retailDraftIdParamsSchema.parse(request.params);
        return service.saveDraft(
          session.id,
          session.context,
          retailDraftInputSchema.parse(request.body),
          draftId,
        );
      });
      routes.delete('/drafts/:draftId', async (request, reply) => {
        const session = await guard.authenticate(request);
        const { draftId } = retailDraftIdParamsSchema.parse(request.params);
        await service.deleteDraft(session.id, session.context, draftId);
        return reply.status(204).send();
      });
      routes.get('/customers/:customerId/history', async (request) => {
        const session = await guard.authenticate(request);
        const { customerId } = customerIdParamsSchema.parse(request.params);
        return service.customerHistory(session.id, session.context, customerId);
      });
      routes.get('/:invoiceId', async (request) => {
        const session = await guard.authenticate(request);
        const { invoiceId } = invoiceIdParamsSchema.parse(request.params);
        return service.get(session.id, session.context, invoiceId);
      });
      routes.post('/:invoiceId/payment-entries', { bodyLimit: 4_096 }, async (request, reply) => {
        requireJson(request);
        const session = await guard.authenticate(request);
        const { invoiceId } = invoiceIdParamsSchema.parse(request.params);
        return reply
          .status(201)
          .send(
            await service.recordPaymentEntry(
              session.id,
              session.context,
              invoiceId,
              invoicePaymentEntryInputSchema.parse(request.body),
            ),
          );
      });
      routes.post('/retail-sales', { bodyLimit: 16_384 }, async (request, reply) => {
        requireJson(request);
        const session = await guard.authenticate(request);
        return reply
          .status(201)
          .send(
            await service.recordRetailSale(
              session.id,
              session.context,
              retailSaleInputSchema.parse(request.body),
            ),
          );
      });
      routes.post('/dealer-purchases', { bodyLimit: 4_096 }, async (request, reply) => {
        requireJson(request);
        const session = await guard.authenticate(request);
        return reply
          .status(201)
          .send(
            await service.recordPurchase(
              session.id,
              session.context,
              purchaseInvoiceInputSchema.parse(request.body),
            ),
          );
      });
    },
    { prefix: '/api/v1/pharmacy/billing' },
  );
}
