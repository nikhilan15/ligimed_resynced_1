import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client.js';

export * from '../generated/prisma/client.js';
export { OtpRepository, OtpRateLimitError } from './otp-repository.js';
export type { OtpVerificationResult } from './otp-repository.js';
export { SessionRepository } from './session-repository.js';

export interface DatabaseClientOptions {
  databaseUrl: string;
}

export function createDatabaseClient(options: DatabaseClientOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: options.databaseUrl,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    max: 10,
  });

  return new PrismaClient({
    adapter,
    // Database errors may contain SQL values or credentials. Callers log only safe metadata.
    log: [],
  });
}
