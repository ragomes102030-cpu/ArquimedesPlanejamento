import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export const RDO_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export type AllowedRdoMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

type WriteAttachmentInput = {
  id: string;
  originalName: string;
  declaredMime: string;
  bytes: Uint8Array;
};

export type StoredAttachment = { path: string; sizeBytes: number; sha256: string; mimeType: AllowedRdoMime };
export type AttachmentStore = {
  write(input: WriteAttachmentInput): StoredAttachment;
  read(id: string, mimeType: AllowedRdoMime): Buffer;
  remove(id: string, mimeType: AllowedRdoMime): void;
};

const extensions: Record<AllowedRdoMime, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf',
};

function detectMime(bytes: Uint8Array): AllowedRdoMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString() === 'RIFF' && Buffer.from(bytes.subarray(8, 12)).toString() === 'WEBP') return 'image/webp';
  if (bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString() === '%PDF-') return 'application/pdf';
  return null;
}

export function createAttachmentStore(rootDir: string): AttachmentStore {
  const root = resolve(rootDir);
  mkdirSync(root, { recursive: true });
  const pathFor = (id: string, mime: AllowedRdoMime): string => {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid attachment id');
    const target = resolve(join(root, `${id}${extensions[mime]}`));
    if (!target.startsWith(`${root}${sep}`)) throw new Error('Attachment path escapes storage root');
    return target;
  };
  return {
    write(input) {
      if (input.bytes.byteLength > RDO_ATTACHMENT_MAX_BYTES) throw new Error('Attachment must not exceed 10 MiB');
      const detected = detectMime(input.bytes);
      if (!detected || detected !== input.declaredMime) throw new Error('Attachment content does not match its declared MIME type');
      const target = pathFor(input.id, detected);
      const temporary = `${target}.tmp`;
      try {
        writeFileSync(temporary, input.bytes, { flag: 'wx' });
        renameSync(temporary, target);
      } catch (error) {
        rmSync(temporary, { force: true });
        throw error;
      }
      return {
        path: target, sizeBytes: input.bytes.byteLength,
        sha256: createHash('sha256').update(input.bytes).digest('hex'), mimeType: detected,
      };
    },
    read: (id, mimeType) => readFileSync(pathFor(id, mimeType)),
    remove: (id, mimeType) => rmSync(pathFor(id, mimeType), { force: true }),
  };
}
