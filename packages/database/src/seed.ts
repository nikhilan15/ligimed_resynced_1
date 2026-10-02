import { createDatabaseClient } from './index.js';
import { seedRbac } from './seed-rbac.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required to seed the database');

const database = createDatabaseClient({ databaseUrl });
try {
  await seedRbac(database);
} finally {
  await database.$disconnect();
}
