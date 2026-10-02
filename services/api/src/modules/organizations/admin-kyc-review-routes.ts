import { SessionRepository, type PrismaClient } from '@ligimed/database';
import type { PrivateObjectStorage } from '@ligimed/storage';
import {
  adminKycDecisionSchema,
  adminKycQueueQuerySchema,
  adminKycStartReviewSchema,
  idSchema,
} from '@ligimed/validation';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { createBrowserAuthentication } from '../../platform/browser-authentication.js';
import { AppError } from '../../platform/errors.js';
import { AdminKycReviewService } from './admin-kyc-review-service.js';

export interface AdminKycReviewOptions {
  database: PrismaClient;
  storage: PrivateObjectStorage;
  cookieName: string;
  csrfSecret: string;
  allowedOrigins: string[];
}

const safeFilename = (filename: string) => filename.replace(/["\\\r\n]/g, '_');
const jsonRequired = (request: FastifyRequest) => {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
    throw new AppError(415, 'JSON_REQUIRED', 'Use application/json for this request.');
  }
};

export async function registerAdminKycReview(app: FastifyInstance, options: AdminKycReviewOptions) {
  const guard = createBrowserAuthentication({
    sessions: new SessionRepository(options.database),
    cookieName: options.cookieName,
    csrfSecret: options.csrfSecret,
    allowedOrigins: options.allowedOrigins,
  });
  const service = new AdminKycReviewService(options.database, options.storage);

  await app.register(
    (routes) => {
      routes.addHook('onRequest', async (_request, reply) => {
        await Promise.resolve();
        void reply.header('cache-control', 'no-store, private').header('pragma', 'no-cache');
      });
      routes.get('/kyc', async (request) => {
        const session = await guard.authenticate(request);
        return service.queue(
          session.id,
          session.context,
          adminKycQueueQuerySchema.parse(request.query),
        );
      });
      routes.get('/kyc/:kycRecordId', async (request) => {
        const session = await guard.authenticate(request);
        const id = idSchema.parse((request.params as { kycRecordId?: unknown }).kycRecordId);
        return service.detail(session.id, session.context, id);
      });
      routes.get('/kyc/:kycRecordId/evidence/:evidenceId/content', async (request, reply) => {
        const session = await guard.authenticate(request);
        const params = request.params as { kycRecordId?: unknown; evidenceId?: unknown };
        const result = await service.evidenceContent(
          session.id,
          session.context,
          idSchema.parse(params.kycRecordId),
          idSchema.parse(params.evidenceId),
        );
        return reply
          .header('content-type', result.contentType)
          .header(
            'content-disposition',
            `attachment; filename="${safeFilename(result.originalFilename)}"`,
          )
          .header('x-content-type-options', 'nosniff')
          .send(result.contents);
      });
      routes.post('/kyc/:kycRecordId/start-review', { bodyLimit: 4096 }, async (request) => {
        jsonRequired(request);
        const session = await guard.authenticate(request);
        adminKycStartReviewSchema.parse(request.body);
        const id = idSchema.parse((request.params as { kycRecordId?: unknown }).kycRecordId);
        return service.startReview(session.id, session.context, id);
      });
      routes.post('/kyc/:kycRecordId/decision', { bodyLimit: 4096 }, async (request) => {
        jsonRequired(request);
        const session = await guard.authenticate(request);
        const id = idSchema.parse((request.params as { kycRecordId?: unknown }).kycRecordId);
        return service.decide(
          session.id,
          session.context,
          id,
          adminKycDecisionSchema.parse(request.body),
        );
      });
    },
    { prefix: '/api/v1/admin/reviews' },
  );
}
