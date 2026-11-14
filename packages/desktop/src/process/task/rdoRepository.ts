/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { RDO_WEATHER_OPTIONS, type RdoEntry, type RdoWeather, type SaveRdoEntryInput } from '@/common/rdo/rdoTypes';
import { ensureKanbanSchema } from './kanbanRepository';

type RdoRow = Omit<RdoEntry, 'linked_card_ids'> & { linked_card_ids: string };
type RdoDatabase = Database.Database;

const RDO_COLUMNS =
  'id, board_id, project_name, work_date, weather, weather_notes, workforce_count, workforce_notes, work_summary, equipment, materials, occurrences, safety_notes, visitors, linked_card_ids, report_task_id, report_assistant_id, created_at, updated_at';
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

export function ensureRdoSchema(db: RdoDatabase): void {
  ensureKanbanSchema(db);
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
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(board_id, work_date)
    );
    CREATE INDEX IF NOT EXISTS idx_rdo_entries_board_date ON rdo_entries(board_id, work_date DESC);
  `);
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
    ? (db.prepare('SELECT id, created_at FROM rdo_entries WHERE id = ?').get(input.id) as
        | { id: string; created_at: number }
        | undefined)
    : undefined;
  if (input.id && !existing) throw new Error('Field report not found');
  if (existingByDate && existingByDate.id !== id) {
    throw new Error('A field report already exists for this project and date');
  }

  if (existing) {
    db.prepare(
      `UPDATE rdo_entries SET
        board_id = ?, project_name = ?, work_date = ?, weather = ?, weather_notes = ?,
        workforce_count = ?, workforce_notes = ?, work_summary = ?, equipment = ?, materials = ?,
        occurrences = ?, safety_notes = ?, visitors = ?, linked_card_ids = ?, updated_at = ?
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
        (${RDO_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`
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
