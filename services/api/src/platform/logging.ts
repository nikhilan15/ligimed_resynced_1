import type { FastifyServerOptions } from 'fastify';

export type SafeLoggerOptions = Exclude<FastifyServerOptions['logger'], boolean | undefined>;

/** Intentionally omit URL/query, headers, bodies, raw errors and stacks from operational logs. */
export function safeLoggerOptions(
  level: string,
  override?: SafeLoggerOptions | false,
): SafeLoggerOptions | false {
  if (override === false) return false;
  return {
    ...(typeof override === 'object' ? override : {}),
    level,
    serializers: {
      req: (request) => ({ method: request.method }),
      res: (response) => ({ statusCode: response.statusCode }),
      err: () => ({ type: 'Error', message: '[REDACTED]', stack: '[REDACTED]' }),
    },
    redact: {
      paths: [
        'authorization',
        'cookie',
        'password',
        'token',
        'otp',
        'code',
        'secret',
        '*.authorization',
        '*.cookie',
        '*.password',
        '*.token',
        '*.otp',
        '*.code',
        '*.secret',
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers.set-cookie',
      ],
      censor: '[REDACTED]',
    },
  };
}
