import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRdoReportMission } from '@/common/rdo/rdoTypes';
import {
  ensureRdoSchema,
  getRdoEntry,
  linkRdoReportTask,
  listRdoEntries,
  saveRdoEntry,
} from '@process/task/rdoRepository';
import { createKanbanCard, deleteKanbanBoard, ensureKanbanSchema, listKanbanBoards } from '@process/task/kanbanRepository';

describe('rdoRepository', () => {
  let db: InstanceType<typeof BetterSqlite3>;
  let boardId: string;

  beforeEach(() => {
    db = new BetterSqlite3(':memory:');
    ensureKanbanSchema(db);
    ensureRdoSchema(db);
    boardId = listKanbanBoards(db)[0].id;
  });

  afterEach(() => {
    db.close();
  });

  const entryInput = (overrides: Record<string, unknown> = {}) => ({
    board_id: boardId,
    work_date: '2026-11-14',
    weather: 'cloudy' as const,
    weather_notes: 'Chuva leve no início da manhã',
    workforce_count: 7,
    workforce_notes: '2 pedreiros, 4 serventes, 1 encarregado',
    work_summary: 'Alvenaria no térreo e organização do canteiro',
    equipment: 'Betoneira 400 L',
    materials: 'Recebidos 20 sacos de cimento',
    occurrences: '',
    safety_notes: 'DDS realizado antes da atividade',
    visitors: 'Fiscalização às 10h',
    linked_card_ids: [] as string[],
    ...overrides,
  });

  it('creates a daily record and reads the structured fields back', () => {
    const saved = saveRdoEntry(db, entryInput());

    expect(saved.project_name).toBe('Kanban');
    expect(saved.weather).toBe('cloudy');
    expect(saved.workforce_count).toBe(7);
    expect(saved.linked_card_ids).toEqual([]);
    expect(listRdoEntries(db, boardId)).toEqual([saved]);
  });

  it('updates the same project-day record instead of creating duplicates', () => {
    const created = saveRdoEntry(db, entryInput());
    const updated = saveRdoEntry(db, entryInput({ id: created.id, work_summary: 'Alvenaria concluída no térreo' }));

    expect(updated.id).toBe(created.id);
    expect(updated.work_summary).toBe('Alvenaria concluída no térreo');
    expect(listRdoEntries(db, boardId)).toHaveLength(1);
    expect(() => saveRdoEntry(db, entryInput())).toThrow(/already exists/i);
  });

  it('rejects invalid dates, unknown services and unstructured workforce counts', () => {
    const card = createKanbanCard(db, {
      board_id: boardId,
      column_id: listKanbanBoards(db)[0].columns[0].id,
      title: 'Serviço válido',
    });
    expect(() => saveRdoEntry(db, entryInput({ work_date: '2026-02-30' }))).toThrow(/valid calendar date/i);
    expect(() => saveRdoEntry(db, entryInput({ workforce_count: 2.5 }))).toThrow(/whole number/i);
    expect(() => saveRdoEntry(db, entryInput({ linked_card_ids: null }))).toThrow(/must be a list/i);
    expect(() => saveRdoEntry(db, entryInput({ linked_card_ids: ['missing-card'] }))).toThrow(/belong to the selected board/i);
    expect(saveRdoEntry(db, entryInput({ linked_card_ids: [card.id] })).linked_card_ids).toEqual([card.id]);
  });

  it('links one report task and builds a structured prompt that forbids invented facts', () => {
    const saved = saveRdoEntry(db, entryInput());
    linkRdoReportTask(db, saved.id, 'task-report-1', 'assistant-1');
    const reloaded = getRdoEntry(db, saved.id)!;
    const prompt = buildRdoReportMission(reloaded, [
      {
        title: 'Alvenaria térreo',
        description: '',
        status: 'Em execução',
        assignee: null,
        planned_quantity: 30,
        quantity_unit: 'm²',
        production_summary: { total_quantity: 14, remaining_quantity: 16, progress_percent: 46.7 },
        logs: [],
      },
    ]);

    expect(reloaded.report_task_id).toBe('task-report-1');
    expect(reloaded.report_assistant_id).toBe('assistant-1');
    expect(reloaded.updated_at).toBe(saved.updated_at);
    expect(prompt).toContain('Não invente fatos');
    expect(prompt).toContain('não necessariamente deste dia');
    expect(prompt).toContain('Obra: Kanban');
    expect(prompt).toContain('Efetivo total: 7');
    expect(prompt).toContain('# Relatório Diário de Obra');
  });

  it('prevents deleting a board that has a field report', () => {
    saveRdoEntry(db, entryInput());

    expect(() => deleteKanbanBoard(db, boardId)).toThrow(/archive it instead/i);
  });
});
