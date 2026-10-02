import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LocalPrivateObjectStorage } from '../src/index.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('local private object storage', () => {
  it('round-trips private content and checks integrity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ligimed-storage-'));
    roots.push(root);
    const storage = new LocalPrivateObjectStorage(root);
    const contents = Buffer.from('private evidence');
    const organizationId = randomUUID();
    const objectKey = `organizations/${organizationId}/documents/${randomUUID()}`;
    const checksumSha256 = createHash('sha256').update(contents).digest('hex');
    await storage.put(
      {
        organizationId,
        objectKey,
        contentType: 'application/pdf',
        contentLength: contents.byteLength,
        checksumSha256,
      },
      contents,
    );
    expect(Buffer.from((await storage.read(objectKey))!)).toEqual(contents);
    await storage.delete(objectKey);
    expect(await storage.read(objectKey)).toBeNull();
  });

  it('rejects traversal and checksum mismatches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ligimed-storage-'));
    roots.push(root);
    const storage = new LocalPrivateObjectStorage(root);
    await expect(storage.read('../secret')).rejects.toThrow('Invalid object key');
    const organizationId = randomUUID();
    await expect(
      storage.put(
        {
          organizationId,
          objectKey: `organizations/${organizationId}/documents/${randomUUID()}`,
          contentType: 'application/pdf',
          contentLength: 1,
          checksumSha256: '0'.repeat(64),
        },
        Buffer.from('x'),
      ),
    ).rejects.toThrow('checksum');
  });
});
