import { createHmac } from 'node:crypto';

import type { PrismaClient } from '@ligimed/database';

import { AppError } from '../../platform/errors.js';

/** Durable across restarts; the API socket address is authoritative unless a trusted proxy is configured. */
export class AuthRateLimiter {
  constructor(
    private readonly database: PrismaClient,
    private readonly secret: string,
  ) {}

  async consume(ip: string, action: 'request' | 'verify'): Promise<void> {
    const key = createHmac('sha256', this.secret).update(`auth-ip:${action}:${ip}`).digest('hex');
    const limit = action === 'request' ? 30 : 100;
    const rows = await this.database.$queryRaw<Array<{ count: number }>>`
      INSERT INTO auth_rate_limits (key, count, "expiresAt")
      VALUES (${key}, 1, CURRENT_TIMESTAMP + INTERVAL '15 minutes')
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN auth_rate_limits."expiresAt" <= CURRENT_TIMESTAMP THEN 1
                     ELSE LEAST(auth_rate_limits.count + 1, 1000) END,
        "expiresAt" = CASE WHEN auth_rate_limits."expiresAt" <= CURRENT_TIMESTAMP
                          THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes'
                          ELSE auth_rate_limits."expiresAt" END
      RETURNING count
    `;
    if (!rows[0] || rows[0].count > limit) {
      throw new AppError(429, 'AUTH_RATE_LIMITED', 'Too many attempts. Please try again later.');
    }
  }
}
