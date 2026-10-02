import { randomUUID } from 'node:crypto';

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { AuthorizationError } from '@ligimed/auth';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import { AppError, type ProblemDetails } from './platform/errors.js';
import { safeLoggerOptions, type SafeLoggerOptions } from './platform/logging.js';

export interface ApiConfiguration {
  environment: 'development' | 'test' | 'production';
  allowedOrigins: string[];
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  trustProxy: boolean;
}

export interface ApiOptions {
  configuration: ApiConfiguration;
  logger?: SafeLoggerOptions | false;
  readinessProbes?: Record<string, () => Promise<void>>;
  registerRoutes?: (app: FastifyInstance) => void | Promise<void>;
  onClose?: () => Promise<void>;
}

function problem(
  requestId: string,
  status: number,
  code: string,
  title: string,
  detail: string,
  type = 'application-error',
): ProblemDetails {
  return {
    type: `https://api.ligimed.in/problems/${type}`,
    title,
    status,
    code,
    detail,
    traceId: requestId,
  };
}

export async function buildApi(options: ApiOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: safeLoggerOptions(options.configuration.logLevel, options.logger),
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    trustProxy: options.configuration.trustProxy,
  });

  for (const contentType of ['application/pdf', 'image/jpeg', 'image/png']) {
    app.addContentTypeParser(
      contentType,
      { parseAs: 'buffer', bodyLimit: 5_242_880 },
      (_request, body, done) => done(null, body),
    );
  }

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);
  await app.register(cors, {
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    origin: options.configuration.allowedOrigins,
  });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  if (options.onClose) app.addHook('onClose', options.onClose);
  await app.register(swagger, {
    openapi: {
      info: { title: 'LigiMed API', version: '0.1.0' },
      servers: [{ url: '/api/v1' }],
    },
  });

  if (options.configuration.environment !== 'production') {
    await app.register(swaggerUi, { routePrefix: '/documentation' });
  }

  app.addHook('onSend', async (request, reply) => {
    void reply.header('x-request-id', request.id);
  });

  app.get('/health/live', {
    schema: {
      tags: ['platform'],
      response: { 200: { type: 'object', properties: { status: { type: 'string' } } } },
    },
    handler: () => ({ status: 'alive' }),
  });

  app.get('/health/ready', {
    schema: {
      tags: ['platform'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            checks: { type: 'object', additionalProperties: { type: 'string' } },
          },
        },
        503: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            checks: { type: 'object', additionalProperties: { type: 'string' } },
          },
        },
      },
    },
    handler: async (_request, reply) => {
      const checks: Record<string, string> = {};
      let ready = true;

      for (const [name, probe] of Object.entries(options.readinessProbes ?? {})) {
        try {
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              probe(),
              new Promise<never>((_resolve, reject) => {
                timeout = setTimeout(() => reject(new Error('Readiness timeout')), 5_000);
              }),
            ]);
          } finally {
            if (timeout) clearTimeout(timeout);
          }
          checks[name] = 'ready';
        } catch {
          ready = false;
          checks[name] = 'unavailable';
        }
      }

      if (!ready) void reply.status(503);
      return { status: ready ? 'ready' : 'unavailable', checks };
    },
  });

  app.setNotFoundHandler(async (request, reply) => {
    void reply
      .status(404)
      .type('application/problem+json')
      .send(
        problem(
          request.id,
          404,
          'RESOURCE_NOT_FOUND',
          'Resource not found',
          'No resource exists at this path',
          'not-found',
        ),
      );
  });

  app.setErrorHandler(async (error, request, reply) => {
    void reply.type('application/problem+json');
    if (error instanceof ZodError) {
      const body: ProblemDetails = {
        ...problem(
          request.id,
          422,
          'VALIDATION_FAILED',
          'Request validation failed',
          'One or more fields are invalid',
          'validation',
        ),
        fieldErrors: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: 'Invalid field value',
        })),
      };
      return reply.status(422).send(body);
    }

    if (error instanceof AuthorizationError) {
      return reply
        .status(403)
        .send(
          problem(
            request.id,
            403,
            error.code,
            'Access denied',
            'The requested action is not permitted',
            'authorization',
          ),
        );
    }

    if (error instanceof AppError && error.status >= 400 && error.status < 600) {
      return reply
        .status(error.status)
        .send(problem(request.id, error.status, error.code, error.name, error.message, error.type));
    }

    const frameworkStatus =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? error.statusCode
        : undefined;
    const frameworkErrors: Record<number, { code: string; detail: string }> = {
      400: { code: 'BAD_REQUEST', detail: 'The request could not be processed' },
      413: { code: 'PAYLOAD_TOO_LARGE', detail: 'The request body exceeds the allowed size' },
      415: { code: 'UNSUPPORTED_MEDIA_TYPE', detail: 'The request content type is not supported' },
      429: { code: 'RATE_LIMITED', detail: 'Too many requests; try again later' },
    };
    const safeError =
      typeof frameworkStatus === 'number' ? frameworkErrors[frameworkStatus] : undefined;
    if (safeError && typeof frameworkStatus === 'number') {
      return reply
        .status(frameworkStatus)
        .send(
          problem(
            request.id,
            frameworkStatus,
            safeError.code,
            'Request rejected',
            safeError.detail,
          ),
        );
    }

    request.log.error({ errorType: 'UnhandledError' }, 'Unhandled request error');
    return reply
      .status(500)
      .send(
        problem(
          request.id,
          500,
          'INTERNAL_ERROR',
          'Internal server error',
          'An unexpected error occurred',
          'internal',
        ),
      );
  });

  await options.registerRoutes?.(app);
  await app.ready();
  return app;
}
