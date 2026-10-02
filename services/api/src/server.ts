import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { parseServerEnvironment } from '@ligimed/config';
import { createDatabaseClient } from '@ligimed/database';
import { LocalPrivateObjectStorage } from '@ligimed/storage';

import { buildApi } from './app.js';
import { registerCommerce } from './modules/commerce/commerce-routes.js';
import { registerInventory } from './modules/inventory/inventory-routes.js';
import { registerCustomers } from './modules/customers/customer-routes.js';
import { registerBilling } from './modules/billing/billing-routes.js';
import { registerDocuments } from './modules/documents/document-routes.js';
import { registerAdminAuth } from './modules/identity/admin-auth-routes.js';
import {
  registerDealerAuth,
  registerPharmacyAuth,
} from './modules/identity/pharmacy-auth-routes.js';
import { createDevelopmentOtpInbox } from './modules/identity/development-otp-inbox.js';
import { registerPharmacyMarketplace } from './modules/marketplace/pharmacy-marketplace-routes.js';
import { registerDealerCatalogue } from './modules/marketplace/dealer-catalogue-routes.js';
import { registerAdminKycReview } from './modules/organizations/admin-kyc-review-routes.js';
import { registerPharmacyDashboard } from './modules/organizations/pharmacy-dashboard-routes.js';
import {
  registerDealerKyc,
  registerPharmacyKyc,
} from './modules/organizations/pharmacy-kyc-routes.js';

const environmentFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(environmentFile)) process.loadEnvFile(environmentFile);
const environment = parseServerEnvironment(process.env);
if (environment.OTP_PROVIDER !== 'development' && !environment.GOOGLE_CLIENT_ID) {
  throw new Error(
    'An SMS OtpProvider adapter must be configured before starting authentication in production.',
  );
}
const database = createDatabaseClient({ databaseUrl: environment.DATABASE_URL });
const provider = createDevelopmentOtpInbox(
  resolve(fileURLToPath(new URL('../../../', import.meta.url)), '.local/otp'),
);
if (environment.STORAGE_PROVIDER !== 'local') {
  throw new Error(
    'A private object storage adapter must be configured before using non-local storage.',
  );
}
const storage = new LocalPrivateObjectStorage(
  resolve(fileURLToPath(new URL('../../../', import.meta.url)), '.local/storage'),
);

const app = await buildApi({
  configuration: {
    environment: environment.NODE_ENV,
    allowedOrigins: environment.ALLOWED_ORIGINS,
    logLevel: environment.LOG_LEVEL,
    trustProxy: environment.TRUST_PROXY,
  },
  readinessProbes: {
    database: async () => {
      await database.$queryRaw`SELECT 1`;
    },
  },
  onClose: () => database.$disconnect(),
  registerRoutes: async (api) => {
    const adminCookieName = `${environment.SESSION_COOKIE_NAME}_admin`;
    await registerPharmacyAuth(api, {
      database,
      provider,
      environment: environment.NODE_ENV,
      cookieName: environment.SESSION_COOKIE_NAME,
      csrfSecret: environment.CSRF_SECRET,
      otpSecret: environment.OTP_HASH_SECRET,
      allowedOrigins: environment.ALLOWED_ORIGINS,
      ttlSeconds: environment.SESSION_TTL_SECONDS,
      developmentDelivery: !environment.GOOGLE_CLIENT_ID,
      googleClientId: environment.GOOGLE_CLIENT_ID,
    });
    await registerPharmacyKyc(api, {
      database,
      storage,
      cookieName: environment.SESSION_COOKIE_NAME,
      csrfSecret: environment.CSRF_SECRET,
      allowedOrigins: environment.ALLOWED_ORIGINS,
    });
    const dealerCookieName = `${environment.SESSION_COOKIE_NAME}_dealer`;
    await registerDealerAuth(api, {
      database,
      provider,
      environment: environment.NODE_ENV,
      cookieName: dealerCookieName,
      csrfSecret: environment.CSRF_SECRET,
      otpSecret: environment.OTP_HASH_SECRET,
      allowedOrigins: environment.ALLOWED_ORIGINS,
      ttlSeconds: environment.SESSION_TTL_SECONDS,
      developmentDelivery: !environment.GOOGLE_CLIENT_ID,
      googleClientId: environment.GOOGLE_CLIENT_ID,
    });
    await registerDealerKyc(api, {
      database,
      storage,
      cookieName: dealerCookieName,
      csrfSecret: environment.CSRF_SECRET,
      allowedOrigins: environment.ALLOWED_ORIGINS,
    });
    await registerDealerCatalogue(api, {
      database,
      cookieName: dealerCookieName,
      csrfSecret: environment.CSRF_SECRET,
      allowedOrigins: environment.ALLOWED_ORIGINS,
    });
    await registerPharmacyDashboard(api, {
      database,
      cookieName: environment.SESSION_COOKIE_NAME,
      csrfSecret: environment.CSRF_SECRET,
      allowedOrigins: environment.ALLOWED_ORIGINS,
    });
    await registerPharmacyMarketplace(api, {
      database,
      cookieName: environment.SESSION_COOKIE_NAME,
      csrfSecret: environment.CSRF_SECRET,
      allowedOrigins: environment.ALLOWED_ORIGINS,
    });
    await registerCommerce(api, {
      database,
      pharmacyCookieName: environment.SESSION_COOKIE_NAME,
      dealerCookieName,
      csrfSecret: environment.CSRF_SECRET,
      allowedOrigins: environment.ALLOWED_ORIGINS,
    });
    await registerInventory(api, {
      database,
      cookieName: environment.SESSION_COOKIE_NAME,
      csrfSecret: environment.CSRF_SECRET,
      allowedOrigins: environment.ALLOWED_ORIGINS,
    });
    await registerCustomers(api, {
      database,
      cookieName: environment.SESSION_COOKIE_NAME,
      csrfSecret: environment.CSRF_SECRET,
      allowedOrigins: environment.ALLOWED_ORIGINS,
    });
    await registerBilling(api, {
      database,
      cookieName: environment.SESSION_COOKIE_NAME,
      csrfSecret: environment.CSRF_SECRET,
      allowedOrigins: environment.ALLOWED_ORIGINS,
    });
    await registerDocuments(api, {
      database,
      storage,
      pharmacyCookieName: environment.SESSION_COOKIE_NAME,
      adminCookieName,
      csrfSecret: environment.CSRF_SECRET,
      allowedOrigins: environment.ALLOWED_ORIGINS,
      scheduleReminders: true,
    });
    await registerAdminAuth(api, {
      database,
      provider,
      environment: environment.NODE_ENV,
      cookieName: adminCookieName,
      csrfSecret: environment.CSRF_SECRET,
      otpSecret: environment.OTP_HASH_SECRET,
      allowedOrigins: environment.ALLOWED_ORIGINS,
      ttlSeconds: environment.SESSION_TTL_SECONDS,
      developmentDelivery: !environment.GOOGLE_CLIENT_ID,
      googleClientId: environment.GOOGLE_CLIENT_ID,
    });
    await registerAdminKycReview(api, {
      database,
      storage,
      cookieName: adminCookieName,
      csrfSecret: environment.CSRF_SECRET,
      allowedOrigins: environment.ALLOWED_ORIGINS,
    });
  },
});

let closing = false;
const close = async (signal: string): Promise<void> => {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'Shutting down API');
  try {
    await app.close();
    process.exitCode = 0;
  } catch {
    app.log.error('API shutdown failed');
    process.exitCode = 1;
  }
};

process.once('SIGINT', () => void close('SIGINT'));
process.once('SIGTERM', () => void close('SIGTERM'));

try {
  await app.listen({ host: environment.API_HOST, port: environment.API_PORT });
} catch {
  app.log.error('API startup failed');
  await app.close();
  process.exitCode = 1;
}
