/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Task } from '@/common/task/taskTypes';

export const RDO_WEATHER_OPTIONS = ['clear', 'cloudy', 'rain', 'wind', 'other'] as const;
export type RdoWeather = (typeof RDO_WEATHER_OPTIONS)[number];

export type RdoStatus = 'draft' | 'approved';

export type RdoActor = {
  name: string;
  role: string;
};

export type RdoEntry = {
  id: string;
  board_id: string;
  project_name: string;
  work_date: string;
  weather: RdoWeather;
  weather_notes: string;
  workforce_count: number | null;
  workforce_notes: string;
  work_summary: string;
  equipment: string;
  materials: string;
  occurrences: string;
  safety_notes: string;
  visitors: string;
  linked_card_ids: string[];
  report_task_id: string | null;
  report_assistant_id: string | null;
  status: RdoStatus;
  current_revision: number;
  approved_revision: number | null;
  approved_by_name: string | null;
  approved_by_role: string | null;
  approved_at: number | null;
  approved_hash: string | null;
  approved_snapshot_json: string | null;
  created_at: number;
  updated_at: number;
};

export type SaveRdoEntryInput = Omit<
  RdoEntry,
  | 'id'
  | 'project_name'
  | 'report_task_id'
  | 'report_assistant_id'
  | 'status'
  | 'current_revision'
  | 'approved_revision'
  | 'approved_by_name'
  | 'approved_by_role'
  | 'approved_at'
  | 'approved_hash'
  | 'approved_snapshot_json'
  | 'created_at'
  | 'updated_at'
> & { id?: string; expected_revision?: number; expected_status?: RdoStatus; actor?: RdoActor };

export type GenerateRdoReportInput = {
  entry_id: string;
  assistant_id: string;
};

export type RdoReportService = {
  title: string;
  description: string;
  status: string;
  assignee: string | null;
  planned_quantity: number | null;
  quantity_unit: string | null;
  production_summary?: {
    total_quantity: number;
    remaining_quantity: number | null;
    progress_percent: number | null;
  };
  logs: Array<{
    id?: string;
    idempotency_key?: string;
    work_date: string;
    location: string | null;
    quantity: number | null;
    unit: string | null;
    crew: string | null;
    hours: number | null;
    equipment: string | null;
    occurrence: string | null;
  }>;
};

export type RdoAttachment = {
  id: string;
  board_id: string;
  work_date: string;
  entry_id: string | null;
  card_id: string | null;
  daily_log_id: string | null;
  original_name: string;
  mime_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  size_bytes: number;
  sha256: string;
  caption: string;
  location: string | null;
  created_by_name: string;
  created_by_role: string;
  created_at: number;
  removed_at: number | null;
};

export type RdoEvidenceManifestItem = Pick<
  RdoAttachment,
  'id' | 'original_name' | 'mime_type' | 'size_bytes' | 'sha256' | 'caption' | 'location' | 'card_id' | 'daily_log_id'
>;

export type RdoSnapshotEntry = {
  id: string;
  board_id: string;
  project_name: string;
  work_date: string;
  weather: RdoWeather;
  weather_notes: string;
  workforce_count: number | null;
  workforce_notes: string;
  work_summary: string;
  equipment: string;
  materials: string;
  occurrences: string;
  safety_notes: string;
  visitors: string;
  linked_card_ids: string[];
};

export type RdoSnapshotInput = {
  entry: RdoSnapshotEntry;
  services: RdoReportService[];
  evidence_manifest: RdoEvidenceManifestItem[];
};

export type RdoRevision = {
  id: string;
  entry_id: string;
  revision_number: number;
  snapshot_json: string;
  content_hash: string;
  actor_name: string;
  actor_role: string;
  reason: string;
  created_at: number;
};

export type RdoAuditEventType =
  | 'created'
  | 'migrated'
  | 'saved'
  | 'approved'
  | 'reopened'
  | 'attachment_added'
  | 'attachment_removed'
  | 'report_generated'
  | 'pdf_exported';

export type RdoAuditEvent = {
  id: string;
  entry_id: string;
  event_type: RdoAuditEventType;
  from_status: RdoStatus | null;
  to_status: RdoStatus | null;
  revision_number: number;
  content_hash: string;
  actor_name: string;
  actor_role: string;
  note: string;
  created_at: number;
};

export type RdoDetail = {
  entry: RdoEntry;
  services: RdoReportService[];
  attachments: RdoAttachment[];
  revisions: RdoRevision[];
  audit: RdoAuditEvent[];
};

export type TransitionRdoInput = {
  entry_id: string;
  action: 'approve' | 'reopen';
  expected_revision: number;
  expected_status: RdoStatus;
  actor: RdoActor;
  reason?: string;
};

export type AddRdoAttachmentInput = {
  entry_id: string;
  original_name: string;
  mime_type: RdoAttachment['mime_type'];
  base64: string;
  caption?: string;
  actor: RdoActor;
};

export function buildRdoReportMission(entry: RdoEntry, services: RdoReportService[]): string {
  const serviceDetails =
    services.length === 0
      ? 'Nenhum serviço do Kanban foi vinculado a este diário.'
      : services
          .map((service, index) => {
            const logs =
              service.logs.length === 0
                ? 'Sem apontamentos quantitativos vinculados.'
                : service.logs
                    .map(
                      (log) =>
                        `  - ${log.work_date}: quantidade=${log.quantity ?? 'não informada'} ${log.unit ?? ''}; local=${log.location ?? 'não informado'}; equipe=${log.crew ?? 'não informada'}; horas=${log.hours ?? 'não informadas'}; equipamento=${log.equipment ?? 'não informado'}; ocorrência=${log.occurrence ?? 'nenhuma informada'}`
                    )
                    .join('\n');
            const production = service.production_summary
              ? `Acumulado registrado no card (não necessariamente deste dia): ${service.production_summary.total_quantity}${service.quantity_unit ? ` ${service.quantity_unit}` : ''}; saldo: ${service.production_summary.remaining_quantity ?? 'não calculado'}; avanço: ${service.production_summary.progress_percent ?? 'não calculado'}%.`
              : 'Sem resumo de produção.';
            return `${index + 1}. ${service.title}
   Status no Kanban: ${service.status}
   Descrição: ${service.description || 'Não informada'}
   Equipe indicada: ${service.assignee ?? 'não informada'}
   Quantidade planejada: ${service.planned_quantity ?? 'não informada'} ${service.quantity_unit ?? ''}
   ${production}
${logs}`;
          })
          .join('\n\n');

  return `Você é responsável por redigir o relatório diário de obra abaixo. Gere um relatório objetivo em português do Brasil, em Markdown, pronto para revisão e assinatura do responsável técnico.

REGRAS
- Use somente os dados fornecidos. Não invente fatos, horários, quantidades, condições meteorológicas, nomes ou conclusões.
- Quando um dado não estiver preenchido, escreva "Não informado".
- Diferencie fatos registrados de observações que precisam de confirmação.
- Não declare conformidade técnica, segurança ou medição aprovada sem evidência explícita.
- Não apresente o acumulado do card como produção deste dia; use os apontamentos datados para relatar a produção diária.
- Preserve valores, unidades, nomes e datas exatamente como registrados.

DADOS DO DIÁRIO
Obra: ${entry.project_name}
Data: ${entry.work_date}
Clima: ${entry.weather}
Observações do clima: ${entry.weather_notes || 'Não informado'}
Efetivo total: ${entry.workforce_count ?? 'Não informado'}
Composição/equipes: ${entry.workforce_notes || 'Não informado'}
Resumo dos serviços executados: ${entry.work_summary || 'Não informado'}
Equipamentos: ${entry.equipment || 'Não informado'}
Materiais: ${entry.materials || 'Não informado'}
Ocorrências: ${entry.occurrences || 'Não informado'}
Segurança: ${entry.safety_notes || 'Não informado'}
Visitantes/fiscalização: ${entry.visitors || 'Não informado'}

SERVIÇOS VINCULADOS DO KANBAN
${serviceDetails}

FORMATO OBRIGATÓRIO
# Relatório Diário de Obra — ${entry.project_name}
## Identificação
Obra, data e clima.
## Efetivo e recursos
Efetivo, equipes e equipamentos.
## Serviços executados
Resumo diário e serviços vinculados, com quantidades e unidades quando disponíveis.
## Materiais
Registros de materiais e eventuais faltas informadas.
## Ocorrências e segurança
Ocorrências, segurança e visitantes/fiscalização.
## Pendências e plano de ação
Liste somente pendências e ações que possam ser inferidas dos registros; se não houver informação, indique que não foi informada.
## Conferência
Finalize com "Relatório gerado a partir dos apontamentos disponíveis; requer conferência e aprovação do responsável pela obra."`;
}

export type RdoAPI = {
  list: (boardId: string) => Promise<RdoEntry[]>;
  save: (input: SaveRdoEntryInput) => Promise<RdoEntry>;
  detail: (entryId: string) => Promise<RdoDetail>;
  transition: (input: TransitionRdoInput) => Promise<RdoDetail>;
  exportPdf: (entryId: string) => Promise<{ filename: string; base64: string }>;
  addAttachment: (input: AddRdoAttachmentInput) => Promise<RdoAttachment>;
  removeAttachment: (attachmentId: string, actor: RdoActor) => Promise<void>;
  generateReport: (input: GenerateRdoReportInput) => Promise<Task>;
};
