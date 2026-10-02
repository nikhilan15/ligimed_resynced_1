import { SessionRepository, type PrismaClient } from '@ligimed/database';
import type { PrivateObjectStorage } from '@ligimed/storage';
import {
  idSchema,
  dealerKycProfileInputSchema,
  kycEvidenceMetadataSchema,
  kycSubmitSchema,
  pharmacyKycProfileInputSchema,
} from '@ligimed/validation';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { createBrowserAuthentication } from '../../platform/browser-authentication.js';
import { AppError } from '../../platform/errors.js';
import {
  PRIVATE_FILE_TYPES,
  privateFilename,
  hasValidPrivateSignature,
  attachmentHeader,
} from '../../platform/private-files.js';
import { PartnerKycService } from './pharmacy-kyc-service.js';

const allowedContentTypes = new Set<string>(PRIVATE_FILE_TYPES);

export interface PharmacyKycOptions {
  database: PrismaClient;
  storage: PrivateObjectStorage;
  cookieName: string;
  csrfSecret: string;
  allowedOrigins: string[];
}

function jsonRequired(request: FastifyRequest) {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
    throw new AppError(415, 'JSON_REQUIRED', 'Use application/json for this request.');
  }
}

export async function registerPartnerKyc(
  app: FastifyInstance,
  options: PharmacyKycOptions,
  kind: 'PHARMACY' | 'DEALER',
) {
  const guard = createBrowserAuthentication({
    sessions: new SessionRepository(options.database),
    cookieName: options.cookieName,
    csrfSecret: options.csrfSecret,
    allowedOrigins: options.allowedOrigins,
  });
  const service = new PartnerKycService(options.database, options.storage, kind);

  await app.register(
    (routes) => {
      routes.addHook('onRequest', async (_request, reply) => {
        await Promise.resolve();
        void reply.header('cache-control', 'no-store, private').header('pragma', 'no-cache');
      });

      routes.get('/state', async (request) => {
        const session = await guard.authenticate(request);
        return service.getState(session.id, session.context);
      });

      routes.patch('/profile', { bodyLimit: 32_768 }, async (request) => {
        jsonRequired(request);
        const session = await guard.authenticate(request);
        const input = (
          kind === 'PHARMACY' ? pharmacyKycProfileInputSchema : dealerKycProfileInputSchema
        ).parse(request.body);
        return service.saveProfile(session.id, session.context, input);
      });

      routes.post('/evidence', { bodyLimit: 5_242_880 }, async (request) => {
        const session = await guard.authenticate(request);
        const contentType = request.headers['content-type']?.split(';')[0]?.trim() ?? '';
        if (!allowedContentTypes.has(contentType)) {
          throw new AppError(
            415,
            'KYC_FILE_TYPE_UNSUPPORTED',
            'Upload a PDF, PNG or JPEG document.',
          );
        }
        if (!Buffer.isBuffer(request.body) || request.body.byteLength === 0) {
          throw new AppError(422, 'KYC_FILE_REQUIRED', 'Choose a non-empty document to upload.');
        }
        if (!hasValidPrivateSignature(contentType, request.body)) {
          throw new AppError(422, 'KYC_FILE_INVALID', 'The file contents do not match its type.');
        }
        const metadata = kycEvidenceMetadataSchema.parse(request.query);
        return service.addEvidence(session.id, session.context, metadata, {
          filename: privateFilename(request.headers['x-file-name']),
          contentType,
          contents: request.body,
        });
      });

      routes.get('/evidence/:evidenceId/content', async (request, reply) => {
        const session = await guard.authenticate(request);
        const evidenceId = idSchema.parse((request.params as { evidenceId?: unknown }).evidenceId);
        const result = await service.evidenceContent(session.id, session.context, evidenceId);
        return reply
          .header('content-type', result.contentType)
          .header('content-disposition', attachmentHeader(result.originalFilename))
          .header('x-content-type-options', 'nosniff')
          .send(result.contents);
      });

      routes.delete('/evidence/:evidenceId', async (request) => {
        const session = await guard.authenticate(request);
        const evidenceId = idSchema.parse((request.params as { evidenceId?: unknown }).evidenceId);
        return service.removeEvidence(session.id, session.context, evidenceId);
      });

      routes.post('/submit', { bodyLimit: 4096 }, async (request) => {
        jsonRequired(request);
        const session = await guard.authenticate(request);
        kycSubmitSchema.parse(request.body);
        return service.submit(session.id, session.context);
      });
    },
    { prefix: `/api/v1/${kind.toLowerCase()}/onboarding` },
  );
}

export const registerPharmacyKyc = (app: FastifyInstance, options: PharmacyKycOptions) =>
  registerPartnerKyc(app, options, 'PHARMACY');

export const registerDealerKyc = (app: FastifyInstance, options: PharmacyKycOptions) =>
  registerPartnerKyc(app, options, 'DEALER');
