import { createHash } from 'node:crypto';
import type { RdoAttachment, RdoEvidenceManifestItem, RdoSnapshotInput } from '@/common/rdo/rdoTypes';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function canonicalize(value: unknown): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value as null | boolean | number | string;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  throw new TypeError(`Unsupported value in canonical RDO snapshot: ${typeof value}`);
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function buildEvidenceManifest(attachments: readonly RdoAttachment[]): RdoEvidenceManifestItem[] {
  return attachments
    .filter((attachment) => attachment.removed_at === null)
    .map(({ id, original_name, mime_type, size_bytes, sha256, caption, location, card_id, daily_log_id }) => ({
      id,
      original_name,
      mime_type,
      size_bytes,
      sha256,
      caption,
      location,
      card_id,
      daily_log_id,
    }))
    .toSorted((left, right) => left.id.localeCompare(right.id));
}

export function buildCanonicalRdoSnapshot(input: RdoSnapshotInput): { json: string; hash: string } {
  const json = JSON.stringify(canonicalize(input));
  return { json, hash: sha256Hex(json) };
}
