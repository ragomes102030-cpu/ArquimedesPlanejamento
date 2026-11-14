/**
 * Auditoria do Diário de Campo: imutabilidade do histórico, atomicidade das
 * transições e integridade das evidências.
 *
 * Cada caso aqui nasce de um defeito real encontrado em revisão: o snapshot
 * calculado fora da transação, o UPDATE sem conferir `changes`, a revisão
 * gravada fora da transação e os triggers de imutabilidade.
 */
import BetterSqlite3 from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createKanbanCard,
  createKanbanDailyLog,
  ensureKanbanSchema,
  listKanbanBoards,
  type KanbanDatabase,
} from '@process/task/kanbanRepository';
import {
  addRdoAttachmentMetadata,
  ensureRdoSchema,
  getRdoAttachment,
  getRdoDetail,
  getRdoEntry,
  listRdoAudit,
  recordRdoPdfExport,
  removeRdoAttachmentMetadata,
  saveRdoEntry,
  transitionRdo,
} from '@process/task/rdoRepository';
import { createAttachmentStore, RDO_ATTACHMENT_MAX_BYTES } from '@process/task/rdo/attachmentStore';
import type { RdoActor, SaveRdoEntryInput } from '@/common/rdo/rdoTypes';

const actor: RdoActor = { name: 'Rafael', role: 'Responsavel pela obra' };

describe('integridade transacional do Diário de Campo', () => {
  let dir: string;
  let db: KanbanDatabase;
  let boardId: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'rdo-audit-'));
    db = new BetterSqlite3(path.join(dir, 'tasks.db'));
    ensureKanbanSchema(db);
    boardId = listKanbanBoards(db)[0].id;
    ensureRdoSchema(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const input = (overrides: Partial<SaveRdoEntryInput> = {}): SaveRdoEntryInput => ({
    board_id: boardId,
    work_date: '2026-11-14',
    weather: 'clear',
    weather_notes: '',
    workforce_count: null,
    workforce_notes: '',
    work_summary: 'Alvenaria executada',
    equipment: '',
    materials: '',
    occurrences: '',
    safety_notes: '',
    visitors: '',
    linked_card_ids: [],
    actor,
    ...overrides,
  });

  const attachmentInput = (overrides: Record<string, unknown> = {}) => ({
    id: `evidence-${Math.random().toString(16).slice(2)}`,
    entry_id: '',
    card_id: null,
    daily_log_id: null,
    original_name: 'foto.jpg',
    mime_type: 'image/jpeg' as const,
    size_bytes: 3,
    sha256: 'a'.repeat(64),
    caption: '',
    location: null,
    created_by_name: 'Rafael',
    created_by_role: 'Engenheiro',
    ...overrides,
  });

  it('não aprova duas vezes nem registra evento sem atualizar a linha', () => {
    const entry = saveRdoEntry(db, input());
    transitionRdo(db, {
      entry_id: entry.id,
      action: 'approve',
      expected_revision: 1,
      expected_status: 'draft',
      actor,
    });

    expect(() =>
      transitionRdo(db, {
        entry_id: entry.id,
        action: 'approve',
        expected_revision: 1,
        expected_status: 'draft',
        actor,
      })
    ).toThrow(/conflict/i);

    const audit = listRdoAudit(db, entry.id);
    expect(audit.filter((event) => event.event_type === 'approved')).toHaveLength(1);
    expect(getRdoDetail(db, entry.id).revisions).toHaveLength(1);
  });

  it('reabre com justificativa e preserva o histórico aprovado', () => {
    const entry = saveRdoEntry(db, input());
    const approved = transitionRdo(db, {
      entry_id: entry.id,
      action: 'approve',
      expected_revision: 1,
      expected_status: 'draft',
      actor,
    });
    const frozenHash = approved.entry.approved_hash;
    const frozenSnapshot = approved.entry.approved_snapshot_json;

    const reopened = transitionRdo(db, {
      entry_id: entry.id,
      action: 'reopen',
      expected_revision: 1,
      expected_status: 'approved',
      actor,
      reason: 'Corrigir efetivo',
    });

    expect(reopened.entry.status).toBe('draft');
    expect(reopened.entry.approved_hash).toBeNull();
    // O registro aprovado continua intacto para auditoria.
    expect(approved.entry.approved_hash).toBe(frozenHash);
    expect(approved.entry.approved_snapshot_json).toBe(frozenSnapshot);
    expect(listRdoAudit(db, entry.id).map((event) => event.event_type)).toEqual(['created', 'approved', 'reopened']);
  });

  it('rejeita salvamento com revisão defasada sem criar revisão fantasma', () => {
    const entry = saveRdoEntry(db, input());

    expect(() => saveRdoEntry(db, input({ id: entry.id, expected_revision: 0, work_summary: 'alterado' }))).toThrow(
      /conflict/i
    );
    expect(() => saveRdoEntry(db, input({ id: entry.id, expected_status: 'approved' }))).toThrow(/conflict/i);

    const detail = getRdoDetail(db, entry.id);
    expect(detail.revisions).toHaveLength(1);
    expect(detail.entry.current_revision).toBe(1);
    expect(detail.entry.work_summary).toBe('Alvenaria executada');
  });

  it('cada gravação cria exatamente uma revisão e um evento na mesma transação', () => {
    const entry = saveRdoEntry(db, input());
    saveRdoEntry(db, input({ id: entry.id, work_summary: 'segundo turno' }));
    saveRdoEntry(db, input({ id: entry.id, work_summary: 'terceiro turno' }));

    const detail = getRdoDetail(db, entry.id);
    expect(detail.entry.current_revision).toBe(3);
    expect(detail.revisions.map((revision) => revision.revision_number).sort()).toEqual([1, 2, 3]);
    expect(detail.audit.map((event) => event.event_type)).toEqual(['created', 'saved', 'saved']);
  });

  it('impede UPDATE e DELETE em revisões e em eventos de auditoria', () => {
    const entry = saveRdoEntry(db, input());
    transitionRdo(db, {
      entry_id: entry.id,
      action: 'approve',
      expected_revision: 1,
      expected_status: 'draft',
      actor,
    });

    expect(() =>
      db.prepare('UPDATE rdo_revisions SET snapshot_json = ? WHERE entry_id = ?').run('{}', entry.id)
    ).toThrow(/immutable/i);
    expect(() => db.prepare('DELETE FROM rdo_revisions WHERE entry_id = ?').run(entry.id)).toThrow(/immutable/i);
    expect(() => db.prepare('UPDATE rdo_audit_events SET note = ? WHERE entry_id = ?').run('x', entry.id)).toThrow(
      /immutable/i
    );
    expect(() => db.prepare('DELETE FROM rdo_audit_events WHERE entry_id = ?').run(entry.id)).toThrow(/immutable/i);

    // A configuração é idempotente e não recria os triggers.
    const before = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all();
    ensureRdoSchema(db);
    ensureRdoSchema(db);
    const after = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all();
    expect(after).toEqual(before);
    expect(getRdoDetail(db, entry.id).revisions).toHaveLength(1);
  });

  it('congela o snapshot aprovado mesmo quando um apontamento posterior é criado', () => {
    const board = listKanbanBoards(db)[0];
    const card = createKanbanCard(db, { board_id: boardId, column_id: board.columns[0].id, title: 'Alvenaria' });
    createKanbanDailyLog(db, {
      card_id: card.id,
      idempotency_key: 'rdo-audit-log-1',
      work_date: '2026-11-14',
      quantity: 4,
      unit: 'm2',
    });
    const entry = saveRdoEntry(db, input({ linked_card_ids: [card.id] }));
    const approved = transitionRdo(db, {
      entry_id: entry.id,
      action: 'approve',
      expected_revision: 1,
      expected_status: 'draft',
      actor,
    });
    const frozenHash = approved.entry.approved_hash;

    createKanbanDailyLog(db, {
      card_id: card.id,
      idempotency_key: 'rdo-audit-log-2',
      work_date: '2026-11-14',
      quantity: 9,
      unit: 'm2',
    });

    const reloaded = getRdoEntry(db, entry.id)!;
    expect(reloaded.approved_hash).toBe(frozenHash);
    expect(reloaded.approved_snapshot_json).toBe(approved.entry.approved_snapshot_json);
    expect(reloaded.approved_snapshot_json).toContain('rdo-audit-log-1');
    expect(reloaded.approved_snapshot_json).not.toContain('rdo-audit-log-2');
    // A produção do dia, porém, continua visível para consulta.
    expect(getRdoDetail(db, entry.id).services[0].logs.map((log) => log.quantity)).toEqual([4, 9]);
  });

  it('traz do Kanban somente os cards com vínculo ou apontamento na data', () => {
    const board = listKanbanBoards(db)[0];
    const linked = createKanbanCard(db, { board_id: boardId, column_id: board.columns[0].id, title: 'Card vinculado' });
    const automatic = createKanbanCard(db, {
      board_id: boardId,
      column_id: board.columns[0].id,
      title: 'Card por apontamento',
    });
    const otherDay = createKanbanCard(db, {
      board_id: boardId,
      column_id: board.columns[0].id,
      title: 'Card de outra data',
    });

    createKanbanDailyLog(db, {
      card_id: automatic.id,
      idempotency_key: 'auto-1',
      work_date: '2026-11-14',
      quantity: 7,
      unit: 'm2',
    });
    createKanbanDailyLog(db, {
      card_id: otherDay.id,
      idempotency_key: 'other-1',
      work_date: '2026-11-13',
      quantity: 3,
      unit: 'm2',
    });

    const entry = saveRdoEntry(db, input({ linked_card_ids: [linked.id] }));
    const titles = getRdoDetail(db, entry.id).services.map((service) => service.title);

    expect(titles).toContain('Card vinculado');
    expect(titles).toContain('Card por apontamento');
    expect(titles).not.toContain('Card de outra data');

    const auto = getRdoDetail(db, entry.id).services.find((service) => service.title === 'Card por apontamento')!;
    expect(auto.logs).toHaveLength(1);
    expect(auto.logs[0].quantity).toBe(7);
    // O acumulado do card é contexto, não produção do dia.
    expect(auto.production_summary?.total_quantity).toBe(7);
  });

  it('mantém quantidade nula como não medida, nunca como zero', () => {
    const board = listKanbanBoards(db)[0];
    const card = createKanbanCard(db, { board_id: boardId, column_id: board.columns[0].id, title: 'Servico' });
    createKanbanDailyLog(db, {
      card_id: card.id,
      idempotency_key: 'null-qty',
      work_date: '2026-11-14',
      occurrence: 'Servico em execucao',
    });
    const entry = saveRdoEntry(db, input({ linked_card_ids: [card.id] }));
    const service = getRdoDetail(db, entry.id).services[0];

    expect(service.logs[0].quantity).toBeNull();
    expect(service.production_summary?.total_quantity).toBe(0);
    expect(service.production_summary?.remaining_quantity).toBeNull();
  });

  it('rejeita o 31º anexo ativo e mantém a auditoria sem evento', () => {
    const entry = saveRdoEntry(db, input());
    for (let index = 0; index < 30; index += 1) {
      addRdoAttachmentMetadata(db, attachmentInput({ id: `evidence-${index}`, entry_id: entry.id }));
    }

    expect(() => addRdoAttachmentMetadata(db, attachmentInput({ id: 'evidence-30', entry_id: entry.id }))).toThrow(
      /30 active attachments/i
    );
    expect(getRdoDetail(db, entry.id).attachments).toHaveLength(30);
    expect(listRdoAudit(db, entry.id).filter((event) => event.event_type === 'attachment_added')).toHaveLength(30);
  });

  it('não grava metadata nem evento quando o diário não existe', () => {
    expect(() => addRdoAttachmentMetadata(db, attachmentInput({ entry_id: 'rdo-inexistente' }))).toThrow(/not found/i);
    expect(db.prepare('SELECT COUNT(*) AS count FROM rdo_attachments').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM rdo_audit_events').get()).toEqual({ count: 0 });
  });

  it('exige nome e função para anexar e para remover evidência', () => {
    const entry = saveRdoEntry(db, input());
    const saved = addRdoAttachmentMetadata(db, attachmentInput({ entry_id: entry.id }));

    expect(() =>
      addRdoAttachmentMetadata(db, attachmentInput({ id: 'evidence-x', entry_id: entry.id, created_by_name: ' ' }))
    ).toThrow(/name and role/i);
    expect(() => removeRdoAttachmentMetadata(db, saved.id, { name: '', role: 'Engenheiro' })).toThrow(/name and role/i);
    expect(() => removeRdoAttachmentMetadata(db, saved.id, { name: 'Rafael', role: ' ' })).toThrow(/name and role/i);
  });

  it('não anexa nem remove evidência em diário aprovado', () => {
    const entry = saveRdoEntry(db, input());
    const saved = addRdoAttachmentMetadata(db, attachmentInput({ entry_id: entry.id }));
    transitionRdo(db, {
      entry_id: entry.id,
      action: 'approve',
      expected_revision: 1,
      expected_status: 'draft',
      actor,
    });

    expect(() => addRdoAttachmentMetadata(db, attachmentInput({ id: 'evidence-late', entry_id: entry.id }))).toThrow(
      /draft/i
    );
    expect(() => removeRdoAttachmentMetadata(db, saved.id, actor)).toThrow(/draft/i);
    expect(getRdoAttachment(db, saved.id).removed_at).toBeNull();
  });

  it('remove a evidência com auditoria e mantém o registro histórico', () => {
    const entry = saveRdoEntry(db, input());
    const saved = addRdoAttachmentMetadata(db, attachmentInput({ entry_id: entry.id }));

    removeRdoAttachmentMetadata(db, saved.id, actor);

    expect(getRdoAttachment.bind(null, db, saved.id)).toThrow();
    expect(getRdoDetail(db, entry.id).attachments).toHaveLength(0);
    expect(listRdoAudit(db, entry.id).map((event) => event.event_type)).toEqual([
      'created',
      'attachment_added',
      'attachment_removed',
    ]);
  });

  it('registra a exportação de PDF com o ator responsável', () => {
    const entry = saveRdoEntry(db, input());
    recordRdoPdfExport(db, entry.id, actor);

    const events = listRdoAudit(db, entry.id).filter((event) => event.event_type === 'pdf_exported');
    expect(events).toHaveLength(1);
    expect(events[0].actor_name).toBe('Rafael');
    expect(events[0].actor_role).toBe('Responsavel pela obra');
    expect(() => recordRdoPdfExport(db, entry.id, { name: ' ', role: 'x' })).toThrow(/name and role/i);
  });
});

describe('evidências em disco', () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  const newStore = () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rdo-evidence-'));
    roots.push(root);
    return { root, store: createAttachmentStore(root) };
  };

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

  it('nunca deixa o nome original controlar o caminho físico', () => {
    const { root, store } = newStore();
    const saved = store.write({
      id: 'evidence-safe',
      originalName: '../../fora.png',
      declaredMime: 'image/png',
      bytes: png,
    });
    expect(saved.path.startsWith(root)).toBe(true);
    expect(saved.path).not.toContain('..');
    expect(readFileSync(saved.path)).toEqual(png);
  });

  it('rejeita MIME declarado que não bate com o conteúdo', () => {
    const { store } = newStore();
    expect(() =>
      store.write({ id: 'fake', originalName: 'x.pdf', declaredMime: 'application/pdf', bytes: png })
    ).toThrow(/content/i);
    expect(() => store.write({ id: 'fake2', originalName: 'x.png', declaredMime: 'image/jpeg', bytes: png })).toThrow(
      /content/i
    );
  });

  it('rejeita o que passa de 10 MiB', () => {
    const { store } = newStore();
    const pdf = Buffer.alloc(RDO_ATTACHMENT_MAX_BYTES + 1, 0x25);
    pdf.write('%PDF-', 0);
    expect(() =>
      store.write({ id: 'big', originalName: 'x.pdf', declaredMime: 'application/pdf', bytes: pdf })
    ).toThrow(/10 MiB/i);
  });
});
