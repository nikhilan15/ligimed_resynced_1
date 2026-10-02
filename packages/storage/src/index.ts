import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export interface UploadRequest {
  organizationId: string;
  objectKey: string;
  contentType: string;
  contentLength: number;
  checksumSha256: string;
}

export interface PresignedOperation {
  url: string;
  expiresAt: Date;
  requiredHeaders: Readonly<Record<string, string>>;
}

export interface StoredObjectMetadata {
  objectKey: string;
  contentType: string;
  contentLength: number;
  checksumSha256: string;
  etag?: string;
}

export interface ObjectStorage {
  createUpload(request: UploadRequest): Promise<PresignedOperation>;
  createDownload(objectKey: string, expiresInSeconds: number): Promise<PresignedOperation>;
  stat(objectKey: string): Promise<StoredObjectMetadata | null>;
  delete(objectKey: string): Promise<void>;
}

/** Server-managed private objects used when clients must not receive storage credentials. */
export interface PrivateObjectStorage {
  put(request: UploadRequest, contents: Uint8Array): Promise<StoredObjectMetadata>;
  read(objectKey: string): Promise<Uint8Array | null>;
  delete(objectKey: string): Promise<void>;
}

function safePath(root: string, objectKey: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(objectKey) || objectKey.includes('//')) {
    throw new Error('Invalid object key');
  }
  const target = resolve(root, ...objectKey.split('/'));
  const fromRoot = relative(root, target);
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) throw new Error('Invalid object key');
  return target;
}

/** Durable local-development adapter. Production configuration rejects this provider. */
export class LocalPrivateObjectStorage implements PrivateObjectStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(request: UploadRequest, contents: Uint8Array): Promise<StoredObjectMetadata> {
    if (!request.objectKey.startsWith(`organizations/${request.organizationId}/`)) {
      throw new Error('Object key is outside the organization namespace');
    }
    if (contents.byteLength !== request.contentLength) throw new Error('Object length mismatch');
    const checksum = createHash('sha256').update(contents).digest('hex');
    if (checksum !== request.checksumSha256) throw new Error('Object checksum mismatch');
    const target = safePath(this.root, request.objectKey);
    await mkdir(resolve(target, '..'), { recursive: true });
    const temporary = `${target}.${randomUUID()}.upload`;
    try {
      await writeFile(temporary, contents, { flag: 'wx' });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    return {
      objectKey: request.objectKey,
      contentType: request.contentType,
      contentLength: contents.byteLength,
      checksumSha256: checksum,
      etag: checksum,
    };
  }

  async read(objectKey: string): Promise<Uint8Array | null> {
    try {
      return await readFile(safePath(this.root, objectKey));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async delete(objectKey: string): Promise<void> {
    await rm(safePath(this.root, objectKey), { force: true });
  }
}

export function organizationObjectKey(organizationId: string, documentId: string): string {
  return `organizations/${organizationId}/documents/${documentId}`;
}
