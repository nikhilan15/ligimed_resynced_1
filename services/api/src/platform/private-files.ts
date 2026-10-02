import { AppError } from './errors.js';

export const PRIVATE_FILE_LIMIT = 5_242_880;
export const PRIVATE_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

export function privateFilename(value: string | string[] | undefined) {
  if (typeof value !== 'string' || value.length > 768)
    throw new AppError(422, 'INVALID_FILENAME', 'A valid file name is required.');
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new AppError(422, 'INVALID_FILENAME', 'A valid file name is required.');
  }
  const filename = decoded
    .split(/[\\/]/)
    .at(-1)
    ?.split('')
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join('')
    .trim();
  if (!filename || filename.length > 255)
    throw new AppError(422, 'INVALID_FILENAME', 'A valid file name is required.');
  return filename;
}

export function hasValidPrivateSignature(contentType: string, contents: Uint8Array): boolean {
  return contentType === 'application/pdf'
    ? Buffer.from(contents.subarray(0, 5)).toString() === '%PDF-'
    : contentType === 'image/png'
      ? Buffer.from(contents.subarray(0, 8)).equals(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        )
      : contentType === 'image/jpeg' &&
        contents[0] === 0xff &&
        contents[1] === 0xd8 &&
        contents[2] === 0xff;
}

export function validatePrivateFile(contentType: string, contents: unknown): Buffer {
  if (!(PRIVATE_FILE_TYPES as readonly string[]).includes(contentType))
    throw new AppError(415, 'FILE_TYPE_UNSUPPORTED', 'Upload a PDF, JPG or PNG document.');
  if (!Buffer.isBuffer(contents) || !contents.length || contents.length > PRIVATE_FILE_LIMIT)
    throw new AppError(422, 'FILE_SIZE_INVALID', 'Choose a non-empty file up to 5 MB.');
  const valid = hasValidPrivateSignature(contentType, contents);
  if (!valid)
    throw new AppError(422, 'FILE_CONTENT_INVALID', 'The file contents do not match its type.');
  return contents;
}

export const attachmentHeader = (filename: string) =>
  `attachment; filename="${filename.replace(/[^A-Za-z0-9._ -]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16)}`)}`;
