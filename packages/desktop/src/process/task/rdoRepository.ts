/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import {
  RDO_WEATHER_OPTIONS,
  type RdoActor,
  type RdoAuditEvent,
  type RdoDetail,
  type RdoEntry,
  type RdoReportService,
  type RdoRevision,
  type RdoWeather,
  type SaveRdoEntryInput,
  type TransitionRdoInput,
} from '@/common/rdo/rdoTypes';
import { ensureKanbanSchema } from './kanbanRepository';
import { buildCanonicalRdoSnapshot } from './rdo/canonicalSnapshot';

type RdoRow = Omit<RdoEntry, 'linked_card_ids'> & { linked_card_ids: string };
type RdoDatabase = Database.Database;

const RDO_COLUMNS =
  'id, board_id, project_name, work_date, weather, weather_notes, workforce_count, workforce_notes, work_summary, equipment, materials, occurrences, safety_notes, visitors, linked_card_ids, report_task_id, report_assistant_id, status, current_revision, approved_revision, approved_by_name, approved_by_role, approved_at, approved_hash, approved_snapshot_json, created_at, updated_at';
const TEXT_LIMITS = {
  weather_notes: 1000,
  workforce_notes: 3000,
  work_summary: 8000,
  equipment: 3000,
  materials: 3000,
  occurrences: 5000,
  safety_notes: 3000,
  visitors: 2000,
} as const;

function createId(): string {
  return `rdo-${Date.now()}-${randomBytes(4).toString('hex')}`;
}

function validateWorkDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error('Work date must use YYYY-MM-DD format');
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (parsed.toISOString().slice(0, 10) !== value) throw new Error('Work date is not a valid calendar date');
  return value;
}

function normalizeText(value: string, field: keyof typeof TEXT_LIMITS): string {
  if (typeof value !== 'string') throw new Error(`${field} must be text`);
  const normalized = value.trim();
  if (normalized.length > TEXT_LIMITS[field]) throw new Error(`${field} must not exceed ${TEXT_LIMITS[field]} characters`);
  return normalized;
}

function toEntry(row: RdoRow): RdoEntry {
  let linkedCardIds: unknown;
  try {
    linkedCardIds = JSON.parse(row.linked_card_ids);
  } catch {
    throw new Error(`RDO ${row.id} has invalid linked card data`);
  }
  if (!Array.isArray(linkedCardIds) || linkedCardIds.some((id) => typeof id !== 'string')) {
    throw new Error(`RDO ${row.id} has invalid linked card data`);
  }
  return { ...row, linked_card_ids: linkedCardIds };
}

function snapshotEntry(entry: RdoEntry) {
  const {
    id, board_id, project_name, work_date, weather, weather_notes, workforce_count, workforce_notes,
    work_summary, equipment, materials, occurrences, safety_notes, visitors, linked_card_ids,
  } = entry;
  return {
    id, board_id, project_name, work_date, weather, weather_notes, workforce_count, workforce_notes,
    work_summary, equipment, materials, occurrences, safety_notes, visitors, linked_card_ids,
  };
}

function listDayServices(db: RdoDatabase, entry: RdoEntry): RdoReportService[] {
  const rows = db.prepare(`
    SELECT c.id, c.title, c.description, c.assignee, c.planned_quantity, c.quantity_unit,
           col.name AS status, c.position
      FROM kanban_cards c JOIN kanban_columns col ON col.id = c.column_id
     WHERE c.board_id = ? AND c.archived = 0
       AND (c.id IN (SELECT value FROM json_each(?)) OR EXISTS (
         SELECT 1 FROM kanban_daily_logs l WHERE l.card_id = c.id AND l.work_date = ?
       ))
     ORDER BY c.position, c.id
  `).all(entry.board_id, JSON.stringify(entry.linked_card_ids), entry.work_date) as Array<{
    id: string; title: string; description: string; assignee: string | null; planned_quantity: number | null;
    quantity_unit: string | null; status: string;
  }>;
  const logs = db.prepare(`
    SELECT id, idempotency_key, work_date, location, quantity, unit, crew, hours, equipment, occurrence
      FROM kanban_daily_logs WHERE card_id = ? AND work_date = ? ORDER BY created_at, id
  `);
  return rows.map((row) => ({
    title: row.title, description: row.description, status: row.status, assignee: row.assignee,
    planned_quantity: row.planned_quantity, quantity_unit: row.quantity_unit,
    logs: logs.all(row.id, entry.work_date) as RdoReportService['logs'],
  }));
}

function actorOrLocal(actor?: RdoActor): RdoActor {
  return { name: actor?.name.trim() || 'Usuario local', role: actor?.role.trim() || 'Responsavel pela obra' };
}

function createRevision(db: RdoDatabase, entry: RdoEntry, actor: RdoActor, reason: string, eventType: string): void {
  const snapshot = buildCanonicalRdoSnapshot({ entry: snapshotEntry(entry), services: listDayServices(db, entry), evidence_manifest: [] });
  const timestamp = Date.now();
  db.prepare(`INSERT INTO rdo_revisions
    (id, entry_id, revision_number, snapshot_json, content_hash, actor_name, actor_role, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(createId(), entry.id, entry.current_revision, snapshot.json, snapshot.hash, actor.name, actor.role, reason, timestamp);
  db.prepare(`INSERT INTO rdo_audit_events
    (id, entry_id, event_type, from_status, to_status, revision_number, content_hash, actor_name, actor_role, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(createId(), entry.id, eventType, null, entry.status, entry.current_revision, snapshot.hash, actor.name, actor.role, reason, timestamp);
}

function migrateUnversionedEntries(db: RdoDatabase): void {
  const rows = db.prepare(`SELECT ${RDO_COLUMNS} FROM rdo_entries WHERE current_revision = 0`).all() as RdoRow[];
  const migrate = db.transaction(() => {
    for (const row of rows) {
      db.prepare("UPDATE rdo_entries SET status = 'draft', current_revision = 1 WHERE id = ?").run(row.id);
      const updated = db.prepare(`SELECT ${RDO_COLUMNS} FROM rdo_entries WHERE id = ?`).get(row.id) as RdoRow;
      createRevision(db, toEntry(updated), { name: 'Migracao 2.5.0', role: 'Sistema' }, 'Registro existente preservado', 'migrated');
    }
  });
  migrate();
}

export function ensureRdoSchema(db: RdoDatabase): void {
  ensureKanbanSchema(db);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS rdo_entries (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL,
      project_name TEXT NOT NULL,
      work_date TEXT NOT NULL,
      weather TEXT NOT NULL DEFAULT 'other',
      weather_notes TEXT NOT NULL DEFAULT '',
      workforce_count INTEGER,
      workforce_notes TEXT NOT NULL DEFAULT '',
      work_summary TEXT NOT NULL DEFAULT '',
      equipment TEXT NOT NULL DEFAULT '',
      materials TEXT NOT NULL DEFAULT '',
      occurrences TEXT NOT NULL DEFAULT '',
      safety_notes TEXT NOT NULL DEFAULT '',
      visitors TEXT NOT NULL DEFAULT '',
      linked_card_ids TEXT NOT NULL DEFAULT '[]',
      report_task_id TEXT,
      report_assistant_id TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      current_revision INTEGER NOT NULL DEFAULT 0,
      approved_revision INTEGER,
      approved_by_name TEXT,
      approved_by_role TEXT,
      approved_at INTEGER,
      approved_hash TEXT,
      approved_snapshot_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(board_id, work_date)
    );
    CREATE INDEX IF NOT EXISTS idx_rdo_entries_board_date ON rdo_entries(board_id, work_date DESC);
    CREATE TABLE IF NOT EXISTS rdo_revisions (
      id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, revision_number INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL, content_hash TEXT NOT NULL, actor_name TEXT NOT NULL,
      actor_role TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL,
      UNIQUE(entry_id, revision_number), FOREIGN KEY(entry_id) REFERENCES rdo_entries(id)
    );
    CREATE TABLE IF NOT EXISTS rdo_audit_events (
      id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, event_type TEXT NOT NULL,
      from_status TEXT, to_status TEXT, revision_number INTEGER NOT NULL, content_hash TEXT NOT NULL,
      actor_name TEXT NOT NULL, actor_role TEXT NOT NULL, note TEXT NOT NULL, created_at INTEGER NOT NULL,
      FOREIGN KEY(entry_id) REFERENCES rdo_entries(id)
    );
    CREATE TABLE IF NOT EXISTS rdo_attachments (
      id TEXT PRIMARY KEY, board_id TEXT NOT NULL, work_date TEXT NOT NULL, entry_id TEXT,
      card_id TEXT, daily_log_id TEXT, original_name TEXT NOT NULL, mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '', location TEXT,
      created_by_name TEXT NOT NULL, created_by_role TEXT NOT NULL, created_at INTEGER NOT NULL,
      removed_at INTEGER, FOREIGN KEY(entry_id) REFERENCES rdo_entries(id)
    );
  `);
  const columns = new Set((db.prepare('PRAGMA table_info(rdo_entries)').all() as Array<{ name: string }>).map((c) => c.name));
  const additions: Record<string, string> = {
    status: "TEXT NOT NULL DEFAULT 'draft'", current_revision: 'INTEGER NOT NULL DEFAULT 0',
    approved_revision: 'INTEGER', approved_by_name: 'TEXT', approved_by_role: 'TEXT', approved_at: 'INTEGER',
    approved_hash: 'TEXT', approved_snapshot_json: 'TEXT',
  };
  for (const [name, definition] of Object.entries(additions)) {
    if (!columns.has(name)) db.exec(`ALTER TABLE rdo_entries ADD COLUMN ${name} ${definition}`);
  }
  migrateUnversionedEntries(db);
}

export function listRdoEntries(db: RdoDatabase, boardId: string): RdoEntry[] {
  ensureRdoSchema(db);
  if (!boardId.trim()) throw new Error('RDO board id is required');
  return (db
    .prepare(`SELECT ${RDO_COLUMNS} FROM rdo_entries WHERE board_id = ? ORDER BY work_date DESC, created_at DESC`)
    .all(boardId) as RdoRow[]).map(toEntry);
}

export function getRdoEntry(db: RdoDatabase, id: string): RdoEntry | null {
  ensureRdoSchema(db);
  const row = db.prepare(`SELECT ${RDO_COLUMNS} FROM rdo_entries WHERE id = ?`).get(id) as RdoRow | undefined;
  return row ? toEntry(row) : null;
}

export function saveRdoEntry(db: RdoDatabase, input: SaveRdoEntryInput): RdoEntry {
  ensureRdoSchema(db);
  const boardId = input.board_id.trim();
  const board = db.prepare('SELECT name FROM kanban_boards WHERE id = ? AND archived = 0').get(boardId) as
    | { name: string }
    | undefined;
  if (!board) throw new Error('Select an active Kanban board for this field report');

  const workDate = validateWorkDate(input.work_date);
  if (!(RDO_WEATHER_OPTIONS as readonly string[]).includes(input.weather)) throw new Error('Select a valid weather condition');
  if (
    input.workforce_count !== null &&
    (!Number.isInteger(input.workforce_count) || input.workforce_count < 0 || input.workforce_count > 10000)
  ) {
    throw new Error('Workforce count must be a whole number between 0 and 10000');
  }
  if (!Array.isArray(input.linked_card_ids)) throw new Error('Linked services must be a list');
  const linkedCardIds = [...new Set(input.linked_card_ids)];
  const cardExists = db.prepare('SELECT 1 FROM kanban_cards WHERE id = ? AND board_id = ?');
  for (const cardId of linkedCardIds) {
    if (typeof cardId !== 'string' || !cardExists.get(cardId, boardId)) {
      throw new Error('Every linked service must belong to the selected board');
    }
  }

  const id = input.id?.trim() || createId();
  const timestamp = Date.now();
  const existingByDate = db
    .prepare('SELECT id FROM rdo_entries WHERE board_id = ? AND work_date = ?')
    .get(boardId, workDate) as { id: string } | undefined;
  const existing = input.id
    ? (db.prepare('SELECT id, created_at, status, current_revision FROM rdo_entries WHERE id = ?').get(input.id) as
        | { id: string; created_at: number; status: string; current_revision: number }
        | undefined)
    : undefined;
  if (input.id && !existing) throw new Error('Field report not found');
  if (existingByDate && existingByDate.id !== id) {
    throw new Error('A field report already exists for this project and date');
  }
  if (existing?.status === 'approved') throw new Error('Approved field reports must be reopened before editing');
  if (existing && input.expected_revision !== undefined && input.expected_revision !== existing.current_revision)
    throw new Error('RDO conflict: revision changed');
  if (existing && input.expected_status !== undefined && input.expected_status !== existing.status)
    throw new Error('RDO conflict: status changed');

  if (existing) {
    db.prepare(
      `UPDATE rdo_entries SET
        board_id = ?, project_name = ?, work_date = ?, weather = ?, weather_notes = ?,
        workforce_count = ?, workforce_notes = ?, work_summary = ?, equipment = ?, materials = ?,
        occurrences = ?, safety_notes = ?, visitors = ?, linked_card_ids = ?, current_revision = current_revision + 1, updated_at = ?
       WHERE id = ?`
    ).run(
      boardId,
      board.name,
      workDate,
      input.weather as RdoWeather,
      normalizeText(input.weather_notes, 'weather_notes'),
      input.workforce_count,
      normalizeText(input.workforce_notes, 'workforce_notes'),
      normalizeText(input.work_summary, 'work_summary'),
      normalizeText(input.equipment, 'equipment'),
      normalizeText(input.materials, 'materials'),
      normalizeText(input.occurrences, 'occurrences'),
      normalizeText(input.safety_notes, 'safety_notes'),
      normalizeText(input.visitors, 'visitors'),
      JSON.stringify(linkedCardIds),
      timestamp,
      id
    );
  } else {
    db.prepare(
      `INSERT INTO rdo_entries
        (id, board_id, project_name, work_date, weather, weather_notes, workforce_count, workforce_notes,
         work_summary, equipment, materials, occurrences, safety_notes, visitors, linked_card_ids,
         report_task_id, report_assistant_id, status, current_revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'draft', 1, ?, ?)`
    ).run(
      id,
      boardId,
      board.name,
      workDate,
      input.weather as RdoWeather,
      normalizeText(input.weather_notes, 'weather_notes'),
      input.workforce_count,
      normalizeText(input.workforce_notes, 'workforce_notes'),
      normalizeText(input.work_summary, 'work_summary'),
      normalizeText(input.equipment, 'equipment'),
      normalizeText(input.materials, 'materials'),
      normalizeText(input.occurrences, 'occurrences'),
      normalizeText(input.safety_notes, 'safety_notes'),
      normalizeText(input.visitors, 'visitors'),
      JSON.stringify(linkedCardIds),
      timestamp,
      timestamp
    );
  }
  const saved = getRdoEntry(db, id);
  if (!saved) throw new Error('Field report could not be read after saving');
  createRevision(db, saved, actorOrLocal(input.actor), existing ? 'Dados do diario atualizados' : 'Diario criado', existing ? 'saved' : 'created');
  return saved;
}

export function linkRdoReportTask(db: RdoDatabase, entryId: string, taskId: string, assistantId: string): void {
  ensureRdoSchema(db);
  const result = db
    .prepare(
      `UPDATE rdo_entries SET report_task_id = ?, report_assistant_id = ? WHERE id = ?`
    )
    .run(taskId, assistantId, entryId);
  if (result.changes !== 1) throw new Error('Field report not found');
}

export function listRdoAudit(db: RdoDatabase, entryId: string): RdoAuditEvent[] {
  ensureRdoSchema(db);
  return db.prepare('SELECT * FROM rdo_audit_events WHERE entry_id = ? ORDER BY created_at, id').all(entryId) as RdoAuditEvent[];
}

export function getRdoDetail(db: RdoDatabase, entryId: string): RdoDetail {
  const entry = getRdoEntry(db, entryId);
  if (!entry) throw new Error('Field report not found');
  return {
    entry,
    services: listDayServices(db, entry),
    attachments: db.prepare('SELECT * FROM rdo_attachments WHERE entry_id = ? AND removed_at IS NULL ORDER BY created_at, id').all(entryId) as RdoDetail['attachments'],
    revisions: db.prepare('SELECT * FROM rdo_revisions WHERE entry_id = ? ORDER BY revision_number DESC').all(entryId) as RdoRevision[],
    audit: listRdoAudit(db, entryId),
  };
}

export function transitionRdo(db: RdoDatabase, input: TransitionRdoInput): RdoDetail {
  ensureRdoSchema(db);
  const actor = actorOrLocal(input.actor);
  if (!input.actor?.name.trim() || !input.actor.role.trim()) throw new Error('Name and role are required');
  const current = getRdoEntry(db, input.entry_id);
  if (!current) throw new Error('Field report not found');
  if (current.current_revision !== input.expected_revision || current.status !== input.expected_status)
    throw new Error('RDO conflict: revision or status changed');
  const timestamp = Date.now();
  if (input.action === 'approve') {
    if (current.status !== 'draft') throw new Error('Only a draft field report can be approved');
    const attachments = db.prepare('SELECT * FROM rdo_attachments WHERE entry_id = ? AND removed_at IS NULL').all(current.id) as RdoDetail['attachments'];
    const snapshot = buildCanonicalRdoSnapshot({
      entry: snapshotEntry(current), services: listDayServices(db, current),
      evidence_manifest: attachments.map(({ id, original_name, mime_type, size_bytes, sha256, caption, location, card_id, daily_log_id }) => ({
        id, original_name, mime_type, size_bytes, sha256, caption, location, card_id, daily_log_id,
      })).sort((a, b) => a.id.localeCompare(b.id)),
    });
    db.transaction(() => {
      db.prepare(`UPDATE rdo_entries SET status = 'approved', approved_revision = current_revision,
        approved_by_name = ?, approved_by_role = ?, approved_at = ?, approved_hash = ?, approved_snapshot_json = ?, updated_at = ?
        WHERE id = ? AND status = 'draft' AND current_revision = ?`)
        .run(actor.name, actor.role, timestamp, snapshot.hash, snapshot.json, timestamp, current.id, current.current_revision);
      db.prepare(`INSERT INTO rdo_audit_events
        (id, entry_id, event_type, from_status, to_status, revision_number, content_hash, actor_name, actor_role, note, created_at)
        VALUES (?, ?, 'approved', 'draft', 'approved', ?, ?, ?, ?, ?, ?)`)
        .run(createId(), current.id, current.current_revision, snapshot.hash, actor.name, actor.role, input.reason?.trim() || 'Aprovacao interna', timestamp);
    })();
  } else {
    const reason = input.reason?.trim();
    if (!reason) throw new Error('A reason is required to reopen an approved field report');
    if (current.status !== 'approved') throw new Error('Only an approved field report can be reopened');
    db.transaction(() => {
      db.prepare(`UPDATE rdo_entries SET status = 'draft', approved_revision = NULL, approved_by_name = NULL,
        approved_by_role = NULL, approved_at = NULL, approved_hash = NULL, approved_snapshot_json = NULL, updated_at = ? WHERE id = ?`)
        .run(timestamp, current.id);
      db.prepare(`INSERT INTO rdo_audit_events
        (id, entry_id, event_type, from_status, to_status, revision_number, content_hash, actor_name, actor_role, note, created_at)
        VALUES (?, ?, 'reopened', 'approved', 'draft', ?, ?, ?, ?, ?, ?)`)
        .run(createId(), current.id, current.current_revision, current.approved_hash || '', actor.name, actor.role, reason, timestamp);
    })();
  }
  return getRdoDetail(db, current.id);
}
