import { z } from 'zod';

const booleanFromString = z.enum(['true', 'false']).transform((value) => value === 'true');

const serverEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    DATABASE_URL: z.string().startsWith('postgresql://'),
    REDIS_URL: z
      .url()
      .refine((value) => ['redis:', 'rediss:'].includes(new URL(value).protocol))
      .optional(),
    ALLOWED_ORIGINS: z
      .string()
      .min(1)
      .transform((value) => value.split(',').map((origin) => origin.trim()))
      .pipe(
        z
          .array(
            z
              .url()
              .refine((value) => {
                const url = new URL(value);
                return (
                  ['http:', 'https:'].includes(url.protocol) &&
                  !url.username &&
                  !url.password &&
                  url.pathname === '/' &&
                  !url.search &&
                  !url.hash
                );
              }, 'Use an HTTP(S) origin without credentials, path, query or fragment')
              .transform((value) => new URL(value).origin),
          )
          .min(1),
      ),
    SESSION_COOKIE_NAME: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/)
      .default('ligimed_session'),
    SESSION_TTL_SECONDS: z.coerce.number().int().min(900).max(2_592_000).default(28_800),
    CSRF_SECRET: z
      .string()
      .refine((value) => Buffer.byteLength(value, 'utf8') >= 32, 'Use at least 32 bytes'),
    OTP_HASH_SECRET: z
      .string()
      .refine((value) => Buffer.byteLength(value, 'utf8') >= 32, 'Use at least 32 bytes'),
    OTP_PROVIDER: z.enum(['development', 'sms']),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    STORAGE_PROVIDER: z.enum(['local', 's3', 'gcs']),
    PAYMENT_PROVIDER: z.enum(['sandbox', 'configured']),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    TRUST_PROXY: booleanFromString.default(false),
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV !== 'production') return;

    if (!environment.GOOGLE_CLIENT_ID) {
      context.addIssue({
        code: 'custom',
        message: 'Google Sign-In requires a client ID',
        path: ['GOOGLE_CLIENT_ID'],
      });
    }

    if (environment.CSRF_SECRET === environment.OTP_HASH_SECRET) {
      context.addIssue({
        code: 'custom',
        message: 'Authentication secrets must be distinct',
        path: ['CSRF_SECRET'],
      });
    }
    if (environment.ALLOWED_ORIGINS.some((origin) => !origin.startsWith('https://'))) {
      context.addIssue({
        code: 'custom',
        message: 'Production browser origins require HTTPS',
        path: ['ALLOWED_ORIGINS'],
      });
    }
    if (environment.TRUST_PROXY) {
      context.addIssue({
        code: 'custom',
        message: 'Trusting every proxy is not supported in production',
        path: ['TRUST_PROXY'],
      });
    }

    const unsafeProviders = [
      !environment.GOOGLE_CLIENT_ID && environment.OTP_PROVIDER === 'development'
        ? 'OTP_PROVIDER'
        : undefined,
      environment.STORAGE_PROVIDER === 'local' ? 'STORAGE_PROVIDER' : undefined,
      environment.PAYMENT_PROVIDER === 'sandbox' ? 'PAYMENT_PROVIDER' : undefined,
    ].filter(Boolean);

    if (unsafeProviders.length > 0) {
      context.addIssue({
        code: 'custom',
        message: `Production cannot use development providers: ${unsafeProviders.join(', ')}`,
        path: ['NODE_ENV'],
      });
    }
  });

const publicEnvironmentSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url(),
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;
export type PublicEnvironment = z.infer<typeof publicEnvironmentSchema>;

export function parseServerEnvironment(input: NodeJS.ProcessEnv): ServerEnvironment {
  return serverEnvironmentSchema.parse(input);
}

export function parsePublicEnvironment(
  input: Record<string, string | undefined>,
): PublicEnvironment {
  return publicEnvironmentSchema.parse(input);
}
