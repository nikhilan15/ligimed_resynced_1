import { SessionRepository, type PrismaClient } from '@ligimed/database';
import type { PrivateObjectStorage } from '@ligimed/storage';
import {
  documentListQuerySchema,
  documentUploadMetadataSchema,
  documentReviewInputSchema,
  documentPolicyInputSchema,
  documentSourceSchema,
  idSchema,
} from '@ligimed/validation';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createBrowserAuthentication } from '../../platform/browser-authentication.js';
import { AppError } from '../../platform/errors.js';
import {
  attachmentHeader,
  privateFilename,
  validatePrivateFile,
  PRIVATE_FILE_LIMIT,
} from '../../platform/private-files.js';
import { DocumentService } from './document-service.js';

export interface DocumentOptions {
  database: PrismaClient;
  storage: PrivateObjectStorage;
  pharmacyCookieName: string;
  adminCookieName: string;
  csrfSecret: string;
  allowedOrigins: string[];
  scheduleReminders?: boolean;
}
const jsonRequired = (request: FastifyRequest) => {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json')
    throw new AppError(415, 'JSON_REQUIRED', 'Use application/json.');
};
export async function registerDocuments(app: FastifyInstance, options: DocumentOptions) {
  const service = new DocumentService(options.database, options.storage);
  if (options.scheduleReminders) {
    let active: Promise<void> | null = null;
    const run = () => {
      if (active) return active;
      active = service
        .generateReminders()
        .then((result) => {
          if (result.created) app.log.info({ count: result.created }, 'Document reminders queued');
        })
        .catch(() => {
          app.log.error('Document reminder scan failed');
        })
        .finally(() => {
          active = null;
        });
      return active;
    };
    const timer = setInterval(() => {
      void run();
    }, 3_600_000);
    timer.unref();
    app.addHook('onReady', async () => {
      await run();
    });
    app.addHook('onClose', async () => {
      clearInterval(timer);
      if (active) await active;
    });
  }
  for (const admin of [false, true]) {
    const guard = createBrowserAuthentication({
      sessions: new SessionRepository(options.database),
      cookieName: admin ? options.adminCookieName : options.pharmacyCookieName,
      csrfSecret: options.csrfSecret,
      allowedOrigins: options.allowedOrigins,
    });
    await app.register(
      (routes) => {
        routes.addHook('onRequest', async (_request, reply) => {
          await Promise.resolve();
          void reply.header('cache-control', 'no-store, private').header('pragma', 'no-cache');
        });
        routes.get('/', async (request) => {
          const session = await guard.authenticate(request);
          const query = documentListQuerySchema.parse(request.query);
          return admin
            ? service.adminCenter(session.id, session.context, query)
            : service.center(session.id, session.context, query);
        });
        routes.get('/uploads/:id', async (request) => {
          const session = await guard.authenticate(request);
          return service.detail(
            session.id,
            session.context,
            idSchema.parse((request.params as { id: string }).id),
            admin,
          );
        });
        routes.get('/:source/:id/content', async (request, reply) => {
          const session = await guard.authenticate(request);
          const params = request.params as { source: string; id: string };
          const id = idSchema.parse(params.id);
          const source = documentSourceSchema.parse(params.source.toUpperCase());
          if (admin && source !== 'UPLOAD' && source !== 'KYC')
            throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document was not found.');
          const file =
            source === 'UPLOAD' || source === 'KYC'
              ? await service.content(session.id, session.context, id, source, admin)
              : await service.generatedContent(session.id, session.context, id, source);
          return reply
            .header('content-type', file.contentType)
            .header('content-disposition', attachmentHeader(file.filename))
            .header('x-content-type-options', 'nosniff')
            .header('content-security-policy', "default-src 'none'; sandbox")
            .send(file.contents);
        });
        if (admin) {
          routes.post('/uploads/:id/review', { bodyLimit: 4096 }, async (request) => {
            const session = await guard.authenticate(request);
            jsonRequired(request);
            return service.review(
              session.id,
              session.context,
              idSchema.parse((request.params as { id: string }).id),
              documentReviewInputSchema.parse(request.body),
            );
          });
          routes.put('/policy', { bodyLimit: 4096 }, async (request) => {
            const session = await guard.authenticate(request);
            jsonRequired(request);
            return service.updatePolicy(
              session.id,
              session.context,
              documentPolicyInputSchema.parse(request.body).thresholds,
            );
          });
          routes.post('/reminders/run', { bodyLimit: 4096 }, async (request) => {
            const session = await guard.authenticate(request);
            jsonRequired(request);
            if (!request.body || JSON.stringify(request.body) !== '{}')
              throw new AppError(422, 'INVALID_REQUEST', 'Use an empty JSON object.');
            return service.runReminders(session.id, session.context);
          });
        } else {
          routes.get('/links', async (request) => {
            const session = await guard.authenticate(request);
            return service.links(session.id, session.context);
          });
          routes.post('/uploads', { bodyLimit: PRIVATE_FILE_LIMIT }, async (request, reply) => {
            const session = await guard.authenticate(request);
            const header = request.headers['x-document-metadata'];
            if (typeof header !== 'string' || header.length > 8192)
              throw new AppError(
                422,
                'DOCUMENT_METADATA_REQUIRED',
                'Document details are required.',
              );
            let input: unknown;
            try {
              input = JSON.parse(decodeURIComponent(header));
            } catch {
              throw new AppError(422, 'INVALID_DOCUMENT_METADATA', 'Document details are invalid.');
            }
            const contentType = request.headers['content-type']?.split(';')[0]?.trim() ?? '';
            const contents = validatePrivateFile(contentType, request.body);
            const result = await service.upload(
              session.id,
              session.context,
              documentUploadMetadataSchema.parse(input),
              { contents, contentType, filename: privateFilename(request.headers['x-file-name']) },
            );
            return reply.code(201).send(result);
          });
        }
      },
      { prefix: `/api/v1/${admin ? 'admin' : 'pharmacy'}/documents` },
    );
  }
}
