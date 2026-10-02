import { afterAll, describe, expect, it } from 'vitest';

import { createDatabaseClient } from '../src/index.js';
import { seedRbac } from '../src/seed-rbac.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required for live PostgreSQL integration tests');
const database = createDatabaseClient({ databaseUrl });

async function snapshot() {
  return {
    roles: await database.role.findMany({
      orderBy: { key: 'asc' },
      select: { id: true, key: true, name: true, organizationType: true, isSystem: true },
    }),
    permissions: await database.permission.findMany({
      orderBy: { key: 'asc' },
      select: { id: true, key: true, description: true },
    }),
    mappings: await database.rolePermission.findMany({
      orderBy: [{ roleId: 'asc' }, { permissionId: 'asc' }],
    }),
  };
}

afterAll(async () => database.$disconnect());

describe('RBAC seed against PostgreSQL', () => {
  it('preserves IDs, definitions and permission mappings across repeated and concurrent runs', async () => {
    await seedRbac(database);
    const first = await snapshot();
    expect(first.roles.map((role) => role.key)).toEqual(
      expect.arrayContaining([
        'PHARMACY_ADMIN',
        'DEALER_ADMIN',
        'TRANSPORT_ADMIN',
        'LIGIMED_COMPLIANCE',
      ]),
    );
    await seedRbac(database);
    expect(await snapshot()).toEqual(first);
    await Promise.all([seedRbac(database), seedRbac(database)]);
    expect(await snapshot()).toEqual(first);
  });
});
