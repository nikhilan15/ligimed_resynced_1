import { randomUUID } from 'node:crypto';

import {
  createDatabaseClient,
  SessionRepository,
  type Prisma,
  type PrismaClient,
} from '@ligimed/database';
import { afterAll, describe, expect, it } from 'vitest';

import { GoogleAuthService } from '../src/modules/identity/google-auth-service.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('A live PostgreSQL database is required.');
const database = createDatabaseClient({ databaseUrl });

afterAll(() => database.$disconnect());

describe('Google partner account creation', () => {
  it('issues an onboarding session for a verified Google identity', async () => {
    const rollback = new Error('Rollback diagnostic account');
    let issued = false;
    try {
      await database.$transaction(async (tx) => {
        const transactionBackedClient = {
          $transaction: (callback: (client: Prisma.TransactionClient) => Promise<unknown>) =>
            callback(tx),
        } as PrismaClient;
        const service = new GoogleAuthService(
          transactionBackedClient,
          new SessionRepository(database),
          3600,
        );
        const result = await service.partner(
          {
            subject: `test-${randomUUID()}`,
            email: 'example@gmail.com',
            displayName: 'Test Owner',
          },
          { intent: 'REGISTER', organizationName: 'Test Pharmacy' },
          'PHARMACY',
          randomUUID(),
        );
        expect(result.status).toBe('AUTHENTICATED');
        issued = true;
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    expect(issued).toBe(true);
  });
});
