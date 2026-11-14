import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAttachmentStore } from '@process/task/rdo/attachmentStore';

describe('RDO attachment store', () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  it('stores validated bytes under an internal id and ignores traversal names', () => {
    const root = mkdtempSync(join(tmpdir(), 'rdo-evidence-'));
    roots.push(root);
    const store = createAttachmentStore(root);
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
    const saved = store.write({ id: 'evidence-1', originalName: '../../escape.png', declaredMime: 'image/png', bytes });
    expect(saved.mimeType).toBe('image/png');
    expect(saved.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(saved.path)).toEqual(bytes);
    expect(saved.path.startsWith(root)).toBe(true);
  });

  it('rejects fake content and files larger than 10 MiB', () => {
    const root = mkdtempSync(join(tmpdir(), 'rdo-evidence-'));
    roots.push(root);
    const store = createAttachmentStore(root);
    expect(() =>
      store.write({ id: 'bad', originalName: 'x.jpg', declaredMime: 'image/jpeg', bytes: Buffer.from('MZ') })
    ).toThrow(/content/i);
    expect(() =>
      store.write({
        id: 'large',
        originalName: 'x.pdf',
        declaredMime: 'application/pdf',
        bytes: Buffer.alloc(10 * 1024 * 1024 + 1),
      })
    ).toThrow(/10 MiB/i);
  });
});
