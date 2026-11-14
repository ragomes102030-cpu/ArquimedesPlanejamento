import { describe, expect, it } from 'vitest';
import {
  buildCanonicalRdoSnapshot,
  buildEvidenceManifest,
} from '@process/task/rdo/canonicalSnapshot';
import type { RdoAttachment, RdoSnapshotInput } from '@/common/rdo/rdoTypes';

const snapshot = (overrides: Partial<RdoSnapshotInput> = {}): RdoSnapshotInput => ({
  entry: {
    id: 'rdo-1',
    board_id: 'board-1',
    project_name: 'Obra Alfa',
    work_date: '2026-11-14',
    weather: 'cloudy',
    weather_notes: '',
    workforce_count: null,
    workforce_notes: '',
    work_summary: 'Alvenaria do pavimento térreo',
    equipment: '',
    materials: '',
    occurrences: '',
    safety_notes: '',
    visitors: '',
    linked_card_ids: ['card-1'],
  },
  services: [],
  evidence_manifest: [],
  ...overrides,
});

const attachment = (id: string, sha256: string): RdoAttachment => ({
  id,
  board_id: 'board-1',
  work_date: '2026-11-14',
  entry_id: 'rdo-1',
  card_id: null,
  daily_log_id: null,
  original_name: `${id}.jpg`,
  mime_type: 'image/jpeg',
  size_bytes: 3,
  sha256,
  caption: '',
  location: null,
  created_by_name: 'Rafael',
  created_by_role: 'Engenheiro',
  created_at: 1,
  removed_at: null,
});

describe('canonical RDO snapshots', () => {
  it('produces the same hash regardless of object key order', () => {
    const normal = snapshot();
    const reordered = {
      evidence_manifest: normal.evidence_manifest,
      services: normal.services,
      entry: {
        linked_card_ids: normal.entry.linked_card_ids,
        visitors: normal.entry.visitors,
        safety_notes: normal.entry.safety_notes,
        occurrences: normal.entry.occurrences,
        materials: normal.entry.materials,
        equipment: normal.entry.equipment,
        work_summary: normal.entry.work_summary,
        workforce_notes: normal.entry.workforce_notes,
        workforce_count: normal.entry.workforce_count,
        weather_notes: normal.entry.weather_notes,
        weather: normal.entry.weather,
        work_date: normal.entry.work_date,
        project_name: normal.entry.project_name,
        board_id: normal.entry.board_id,
        id: normal.entry.id,
      },
    } satisfies RdoSnapshotInput;

    expect(buildCanonicalRdoSnapshot(normal).hash).toBe(buildCanonicalRdoSnapshot(reordered).hash);
  });

  it('changes the hash when a factual field changes', () => {
    const before = buildCanonicalRdoSnapshot(snapshot());
    const after = buildCanonicalRdoSnapshot(
      snapshot({ entry: { ...snapshot().entry, work_summary: 'Concretagem concluída' } })
    );

    expect(after.hash).not.toBe(before.hash);
  });

  it('sorts evidence by id before hashing the manifest', () => {
    const a = attachment('a', 'aa');
    const b = attachment('b', 'bb');

    expect(buildEvidenceManifest([b, a])).toEqual(buildEvidenceManifest([a, b]));
  });

  it('keeps null as unmeasured instead of converting it to zero', () => {
    const result = buildCanonicalRdoSnapshot(snapshot());

    expect(JSON.parse(result.json).entry.workforce_count).toBeNull();
    expect(result.json).not.toContain('"workforce_count":0');
  });
});
