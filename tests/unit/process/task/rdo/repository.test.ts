import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createKanbanDailyLog, ensureKanbanSchema, listKanbanBoards } from '@process/task/kanbanRepository';
import { createKanbanCard } from '@process/task/kanbanRepository';
import { ensureRdoSchema, getRdoDetail, saveRdoEntry, transitionRdo } from '@process/task/rdo/repository';

describe('auditable RDO repository', () => {
  let db: InstanceType<typeof BetterSqlite3>;
  let boardId: string;

  beforeEach(() => {
    db = new BetterSqlite3(':memory:');
    ensureKanbanSchema(db);
    boardId = listKanbanBoards(db)[0].id;
    ensureRdoSchema(db);
  });

  afterEach(() => db.close());

  const input = () => ({
    board_id: boardId,
    work_date: '2026-11-14',
    weather: 'clear' as const,
    weather_notes: '',
    workforce_count: null,
    workforce_notes: '',
    work_summary: 'Alvenaria executada',
    equipment: '',
    materials: '',
    occurrences: '',
    safety_notes: '',
    visitors: '',
    linked_card_ids: [] as string[],
    actor: { name: 'Rafael', role: 'Responsavel pela obra' },
  });

  it('creates an initial revision and does not duplicate it when setup runs twice', () => {
    const entry = saveRdoEntry(db, input());
    ensureRdoSchema(db);
    const detail = getRdoDetail(db, entry.id);
    expect(detail.entry.status).toBe('draft');
    expect(detail.revisions).toHaveLength(1);
    expect(detail.audit.filter((event) => event.event_type === 'created')).toHaveLength(1);
  });

  it('approves the expected revision and freezes daily Kanban logs', () => {
    const board = listKanbanBoards(db)[0];
    const card = createKanbanCard(db, { board_id: boardId, column_id: board.columns[0].id, title: 'Alvenaria' });
    createKanbanDailyLog(db, {
      card_id: card.id,
      idempotency_key: 'rdo-log-1',
      work_date: '2026-11-14',
      quantity: 4,
      unit: 'm2',
    });
    const entry = saveRdoEntry(db, { ...input(), linked_card_ids: [card.id] });
    const approved = transitionRdo(db, {
      entry_id: entry.id,
      action: 'approve',
      expected_revision: 1,
      expected_status: 'draft',
      actor: { name: 'Rafael', role: 'Responsavel pela obra' },
    });
    expect(approved.entry.status).toBe('approved');
    expect(approved.entry.approved_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(approved.entry.approved_snapshot_json).toContain('rdo-log-1');
    expect(() => saveRdoEntry(db, { ...input(), id: entry.id, work_summary: 'alterado' })).toThrow(/approved/i);
  });

  it('rejects stale transitions and requires a reason to reopen', () => {
    const entry = saveRdoEntry(db, input());
    expect(() =>
      transitionRdo(db, {
        entry_id: entry.id,
        action: 'approve',
        expected_revision: 0,
        expected_status: 'draft',
        actor: { name: 'Rafael', role: 'Responsavel pela obra' },
      })
    ).toThrow(/conflict/i);
    transitionRdo(db, {
      entry_id: entry.id,
      action: 'approve',
      expected_revision: 1,
      expected_status: 'draft',
      actor: { name: 'Rafael', role: 'Responsavel pela obra' },
    });
    expect(() =>
      transitionRdo(db, {
        entry_id: entry.id,
        action: 'reopen',
        expected_revision: 1,
        expected_status: 'approved',
        actor: { name: 'Rafael', role: 'Responsavel pela obra' },
      })
    ).toThrow(/reason/i);
  });
});
