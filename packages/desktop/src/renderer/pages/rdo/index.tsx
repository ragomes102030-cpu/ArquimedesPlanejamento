import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import ReactMarkdown from 'react-markdown';
import { Button, DatePicker, Empty, Input, InputNumber, Message, Select, Spin, Tag } from '@arco-design/web-react';
import { BookOpen, Plus, Robot, Save } from '@icon-park/react';
import type { RdoAPI, RdoEntry, RdoWeather, SaveRdoEntryInput } from '@/common/rdo/rdoTypes';
import { RDO_WEATHER_OPTIONS } from '@/common/rdo/rdoTypes';
import type { Task } from '@/common/task/taskTypes';
import { useAssistantList } from '@renderer/hooks/assistant/useAssistantList';
import { selectableAssistants } from '@renderer/utils/model/assistantSelection';
import { useKanban } from '../kanban/useKanban';
import { rdoHttpApi } from './rdoHttp';

type RdoDraft = Omit<SaveRdoEntryInput, 'id' | 'board_id'>;

const today = () => dayjs().format('YYYY-MM-DD');

const emptyDraft = (workDate = today()): RdoDraft => ({
  work_date: workDate,
  weather: 'other',
  weather_notes: '',
  workforce_count: null,
  workforce_notes: '',
  work_summary: '',
  equipment: '',
  materials: '',
  occurrences: '',
  safety_notes: '',
  visitors: '',
  linked_card_ids: [],
});

function draftFromEntry(entry: RdoEntry): RdoDraft {
  return {
    work_date: entry.work_date,
    weather: entry.weather,
    weather_notes: entry.weather_notes,
    workforce_count: entry.workforce_count,
    workforce_notes: entry.workforce_notes,
    work_summary: entry.work_summary,
    equipment: entry.equipment,
    materials: entry.materials,
    occurrences: entry.occurrences,
    safety_notes: entry.safety_notes,
    visitors: entry.visitors,
    linked_card_ids: [...entry.linked_card_ids],
  };
}

function statusLabel(task: Task, t: ReturnType<typeof useTranslation>['t']): string {
  return t(`agentTasks.status${task.status.charAt(0).toUpperCase()}${task.status.slice(1)}`, {
    defaultValue: task.status,
  });
}

const RdoPage: React.FC = () => {
  const { t } = useTranslation();
  const { boards, loading: boardsLoading } = useKanban();
  const { assistants, assistantOrder } = useAssistantList();
  const agents = useMemo(() => selectableAssistants(assistants, assistantOrder), [assistantOrder, assistants]);
  const activeBoards = useMemo(() => boards.filter((board) => !board.archived), [boards]);
  const [boardId, setBoardId] = useState<string | null>(null);
  const board = activeBoards.find((item) => item.id === boardId) ?? activeBoards[0] ?? null;
  const [entries, setEntries] = useState<RdoEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedEntry = entries.find((entry) => entry.id === selectedId) ?? null;
  const [draft, setDraft] = useState<RdoDraft>(() => emptyDraft());
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [reportTask, setReportTask] = useState<Task | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const api: RdoAPI = typeof window !== 'undefined' && window.rdoAPI ? window.rdoAPI : rdoHttpApi;

  useEffect(() => {
    if (board && board.id !== boardId) setBoardId(board.id);
  }, [board, boardId]);

  const loadEntries = useCallback(async () => {
    if (!board) return;
    setLoadingEntries(true);
    try {
      const loaded = await api.list(board.id);
      setEntries(loaded);
      setSelectedId((current) => (current && loaded.some((entry) => entry.id === current) ? current : null));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      Message.error(`${t('agentTasks.rdo.loadFailed', { defaultValue: 'Não foi possível carregar os diários.' })} ${detail}`);
    } finally {
      setLoadingEntries(false);
    }
  }, [api, board, t]);

  useEffect(() => {
    setSelectedId(null);
    setDraft(emptyDraft());
    void loadEntries();
  }, [boardId, loadEntries]);

  useEffect(() => {
    if (selectedEntry) {
      setDraft(draftFromEntry(selectedEntry));
      setReportError(null);
    }
  }, [selectedEntry]);

  useEffect(() => {
    if (!selectedEntry?.report_task_id || !window.taskAPI) {
      setReportTask(null);
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const refresh = async () => {
      try {
        const task = await window.taskAPI?.get(selectedEntry.report_task_id!);
        if (active) setReportTask(task);
      } catch (error) {
        if (active) setReportError(error instanceof Error ? error.message : String(error));
      }
    };
    void refresh();
    timer = setInterval(() => void refresh(), 2500);
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [selectedEntry?.report_task_id]);

  const startNew = () => {
    const date = today();
    const existing = entries.find((entry) => entry.work_date === date);
    if (existing) {
      setSelectedId(existing.id);
      return;
    }
    setSelectedId(null);
    setDraft(emptyDraft(date));
    setReportTask(null);
    setReportError(null);
  };

  const saveEntry = async (): Promise<RdoEntry | null> => {
    if (!board) return null;
    setSaving(true);
    try {
      const input: SaveRdoEntryInput = {
        ...draft,
        board_id: board.id,
        ...(selectedId ? { id: selectedId } : {}),
      };
      const saved = await api.save(input);
      setEntries((current) => [saved, ...current.filter((entry) => entry.id !== saved.id)].sort(
        (left, right) => right.work_date.localeCompare(left.work_date)
      ));
      setSelectedId(saved.id);
      Message.success(t('agentTasks.rdo.saved', { defaultValue: 'Diário salvo.' }));
      return saved;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      Message.error(`${t('agentTasks.rdo.saveFailed', { defaultValue: 'Não foi possível salvar o diário.' })} ${detail}`);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const generateReport = async () => {
    if (!window.taskAPI || !board) {
      setReportError(t('agentTasks.rdo.desktopOnly', { defaultValue: 'A geração por agente está disponível no app desktop.' }));
      return;
    }
    if (!agentId) {
      setReportError(t('agentTasks.rdo.agentRequired', { defaultValue: 'Escolha o agente que vai gerar o relatório.' }));
      return;
    }
    setGenerating(true);
    setReportError(null);
    try {
      const saved = await saveEntry();
      if (!saved) return;
      const task = await api.generateReport({ entry_id: saved.id, assistant_id: agentId });
      setReportTask(task);
      const updated = await api.list(board.id);
      setEntries(updated);
      setSelectedId(saved.id);
      Message.success(t('agentTasks.rdo.reportStarted', { defaultValue: 'Geração do relatório iniciada.' }));
    } catch (error) {
      setReportError(error instanceof Error ? error.message : String(error));
    } finally {
      setGenerating(false);
    }
  };

  const reportIsStale =
    Boolean(selectedEntry?.report_task_id && reportTask) && reportTask!.created_at < selectedEntry!.updated_at;
  const hasTaskApi = typeof window !== 'undefined' && Boolean(window.taskAPI);
  const reportBusy = generating || reportTask?.status === 'pending' || reportTask?.status === 'running';
  const weatherLabels: Record<RdoWeather, string> = {
    clear: t('agentTasks.rdo.weather.clear', { defaultValue: 'Aberto' }),
    cloudy: t('agentTasks.rdo.weather.cloudy', { defaultValue: 'Nublado' }),
    rain: t('agentTasks.rdo.weather.rain', { defaultValue: 'Chuva' }),
    wind: t('agentTasks.rdo.weather.wind', { defaultValue: 'Vento forte' }),
    other: t('agentTasks.rdo.weather.other', { defaultValue: 'Outro / não informado' }),
  };

  if (!hasTaskApi && !window.rdoAPI && boardsLoading) {
    return <div className='flex h-full items-center justify-center'><Spin /></div>;
  }

  if (!board) {
    return (
      <div className='flex h-full items-center justify-center p-24px'>
        <Empty description={t('agentTasks.rdo.noBoard', { defaultValue: 'Crie um quadro no Kanban para começar um Diário de Campo.' })} />
      </div>
    );
  }

  return (
    <main className='flex h-full min-h-0 flex-col overflow-y-auto bg-1'>
      <header className='shrink-0 border-b border-solid border-[var(--color-border-2)] px-16px py-16px md:px-30px'>
        <div className='mx-auto flex w-full max-w-1440px flex-wrap items-center justify-between gap-12px'>
          <div className='flex min-w-0 items-center gap-12px'>
            <div className='flex size-40px shrink-0 items-center justify-center rounded-12px bg-[var(--color-fill-2)] text-primary'>
              <BookOpen theme='outline' size='20' />
            </div>
            <div className='min-w-0'>
              <h1 className='m-0 text-22px font-semibold tracking-tight text-t-primary'>
                {t('agentTasks.rdo.title', { defaultValue: 'Diário de Campo' })}
              </h1>
              <p className='mt-3px mb-0 text-12px text-t-secondary'>
                {t('agentTasks.rdo.subtitle', { defaultValue: 'Registro diário da obra, separado das tarefas do Kanban.' })}
              </p>
            </div>
          </div>
          <div className='flex flex-wrap items-center gap-8px'>
            <Select className='min-w-180px' value={board.id} onChange={(value) => setBoardId(value)}>
              {activeBoards.map((item) => <Select.Option key={item.id} value={item.id}>{item.name}</Select.Option>)}
            </Select>
            <Button icon={<Plus size={14} />} onClick={startNew}>
              {t('agentTasks.rdo.newDay', { defaultValue: 'Novo diário de hoje' })}
            </Button>
          </div>
        </div>
      </header>

      <div className='mx-auto grid min-h-0 w-full max-w-1440px flex-1 grid-cols-1 gap-16px p-12px md:p-20px lg:grid-cols-[290px_minmax(0,1fr)]'>
        <aside className='min-h-180px rounded-12px border border-solid border-[var(--color-border-2)] bg-[var(--color-fill-1)] lg:min-h-0 lg:overflow-y-auto'>
          <div className='flex items-center justify-between border-b border-solid border-[var(--color-border-2)] px-14px py-12px'>
            <div>
              <h2 className='m-0 text-13px font-semibold text-t-primary'>{t('agentTasks.rdo.history', { defaultValue: 'Histórico diário' })}</h2>
              <p className='mt-3px mb-0 text-11px text-t-tertiary'>{board.name}</p>
            </div>
            <Tag>{entries.length}</Tag>
          </div>
          {loadingEntries ? <div className='flex justify-center p-20px'><Spin size={16} /></div> : null}
          {!loadingEntries && entries.length === 0 ? (
            <p className='px-14px py-18px text-12px leading-18px text-t-tertiary'>
              {t('agentTasks.rdo.emptyHistory', { defaultValue: 'Nenhum diário registrado para esta obra. Comece pelo registro de hoje.' })}
            </p>
          ) : null}
          <div className='divide-y divide-[var(--color-border-2)]'>
            {entries.map((entry) => (
              <button
                key={entry.id}
                type='button'
                onClick={() => setSelectedId(entry.id)}
                className={`w-full px-14px py-12px text-left transition-colors hover:bg-[var(--color-fill-2)] ${
                  entry.id === selectedId ? 'bg-[var(--color-fill-2)]' : 'bg-transparent'
                }`}
              >
                <span className='flex items-center justify-between gap-8px'>
                  <span className='text-13px font-medium text-t-primary'>{dayjs(entry.work_date).format('ddd, DD [de] MMM')}</span>
                  {entry.report_task_id ? <Robot size={14} className='shrink-0 text-primary' /> : null}
                </span>
                <span className='mt-4px block truncate text-11px text-t-secondary'>
                  {entry.work_summary || t('agentTasks.rdo.noSummary', { defaultValue: 'Sem resumo dos serviços' })}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className='min-w-0 space-y-14px'>
          <div className='rounded-12px border border-solid border-[var(--color-border-2)] bg-[var(--color-fill-1)] p-14px md:p-18px'>
            <div className='mb-14px flex flex-wrap items-start justify-between gap-10px'>
              <div>
                <h2 className='m-0 text-16px font-semibold text-t-primary'>
                  {selectedEntry
                    ? t('agentTasks.rdo.editDay', { defaultValue: 'Registro do dia' })
                    : t('agentTasks.rdo.newDayTitle', { defaultValue: 'Novo registro de campo' })}
                </h2>
                <p className='mt-4px mb-0 text-11px text-t-tertiary'>
                  {t('agentTasks.rdo.editHint', { defaultValue: 'Preencha o que foi observado. O agente só redige o relatório com os dados registrados.' })}
                </p>
              </div>
              {selectedEntry ? <Tag color='blue'>{dayjs(selectedEntry.work_date).format('DD/MM/YYYY')}</Tag> : null}
            </div>

            <div className='grid grid-cols-1 gap-12px md:grid-cols-2'>
              <label className='text-12px text-t-secondary'>
                {t('agentTasks.rdo.date', { defaultValue: 'Data da obra' })}
                <DatePicker className='mt-5px w-full' value={dayjs(draft.work_date)} onChange={(_value, date) => {
                  if (date) {
                    const workDate = date.format('YYYY-MM-DD');
                    const match = entries.find((entry) => entry.work_date === workDate);
                    setSelectedId(match?.id ?? null);
                    setDraft(match ? draftFromEntry(match) : emptyDraft(workDate));
                  }
                }} />
              </label>
              <label className='text-12px text-t-secondary'>
                {t('agentTasks.rdo.weatherLabel', { defaultValue: 'Condição do tempo' })}
                <Select className='mt-5px w-full' value={draft.weather} onChange={(value) => setDraft((current) => ({ ...current, weather: value }))}>
                  {RDO_WEATHER_OPTIONS.map((weather) => <Select.Option key={weather} value={weather}>{weatherLabels[weather]}</Select.Option>)}
                </Select>
              </label>
              <Field label={t('agentTasks.rdo.weatherNotes', { defaultValue: 'Observações do clima / impacto' })}>
                <Input.TextArea value={draft.weather_notes} autoSize={{ minRows: 2, maxRows: 5 }} onChange={(value) => setDraft((current) => ({ ...current, weather_notes: value }))} />
              </Field>
              <label className='text-12px text-t-secondary'>
                {t('agentTasks.rdo.workforceCount', { defaultValue: 'Efetivo total no dia' })}
                <InputNumber className='mt-5px w-full' min={0} precision={0} value={draft.workforce_count ?? undefined} onChange={(value) => setDraft((current) => ({ ...current, workforce_count: typeof value === 'number' ? value : null }))} />
              </label>
              <Field label={t('agentTasks.rdo.workforceNotes', { defaultValue: 'Equipes e funções' })}>
                <Input.TextArea value={draft.workforce_notes} placeholder={t('agentTasks.rdo.workforcePlaceholder', { defaultValue: 'Ex.: 2 pedreiros, 3 serventes, 1 eletricista' })} autoSize={{ minRows: 2, maxRows: 5 }} onChange={(value) => setDraft((current) => ({ ...current, workforce_notes: value }))} />
              </Field>
              <Field label={t('agentTasks.rdo.workSummary', { defaultValue: 'Resumo dos serviços executados' })} wide>
                <Input.TextArea value={draft.work_summary} placeholder={t('agentTasks.rdo.workPlaceholder', { defaultValue: 'O que foi executado hoje, por frente ou ambiente?' })} autoSize={{ minRows: 3, maxRows: 8 }} onChange={(value) => setDraft((current) => ({ ...current, work_summary: value }))} />
              </Field>
              <Field label={t('agentTasks.rdo.services', { defaultValue: 'Serviços do Kanban relacionados' })} wide>
                <Select
                  className='w-full'
                  mode='multiple'
                  allowClear
                  value={draft.linked_card_ids}
                  placeholder={t('agentTasks.rdo.servicesPlaceholder', { defaultValue: 'Selecione os serviços trabalhados hoje' })}
                  onChange={(value) => setDraft((current) => ({ ...current, linked_card_ids: value }))}
                >
                  {board.cards.filter((card) => !card.archived).map((card) => (
                    <Select.Option key={card.id} value={card.id}>{card.title}</Select.Option>
                  ))}
                </Select>
              </Field>
              <Field label={t('agentTasks.rdo.equipment', { defaultValue: 'Equipamentos utilizados' })}>
                <Input.TextArea value={draft.equipment} autoSize={{ minRows: 2, maxRows: 5 }} onChange={(value) => setDraft((current) => ({ ...current, equipment: value }))} />
              </Field>
              <Field label={t('agentTasks.rdo.materials', { defaultValue: 'Materiais / recebimentos / faltas' })}>
                <Input.TextArea value={draft.materials} autoSize={{ minRows: 2, maxRows: 5 }} onChange={(value) => setDraft((current) => ({ ...current, materials: value }))} />
              </Field>
              <Field label={t('agentTasks.rdo.occurrences', { defaultValue: 'Ocorrências e impedimentos' })}>
                <Input.TextArea value={draft.occurrences} autoSize={{ minRows: 2, maxRows: 5 }} onChange={(value) => setDraft((current) => ({ ...current, occurrences: value }))} />
              </Field>
              <Field label={t('agentTasks.rdo.safety', { defaultValue: 'Segurança / inspeções' })}>
                <Input.TextArea value={draft.safety_notes} autoSize={{ minRows: 2, maxRows: 5 }} onChange={(value) => setDraft((current) => ({ ...current, safety_notes: value }))} />
              </Field>
              <Field label={t('agentTasks.rdo.visitors', { defaultValue: 'Fiscalização / visitantes' })} wide>
                <Input.TextArea value={draft.visitors} autoSize={{ minRows: 2, maxRows: 4 }} onChange={(value) => setDraft((current) => ({ ...current, visitors: value }))} />
              </Field>
            </div>
            <div className='mt-14px flex flex-wrap justify-end gap-8px border-t border-solid border-[var(--color-border-2)] pt-12px'>
              <Button type='primary' icon={<Save size={14} />} loading={saving} onClick={() => void saveEntry()}>
                {t('agentTasks.rdo.save', { defaultValue: 'Salvar diário' })}
              </Button>
            </div>
          </div>

          <section className='rounded-12px border border-solid border-[var(--color-border-2)] bg-[var(--color-fill-1)] p-14px md:p-18px'>
            <div className='flex flex-wrap items-start justify-between gap-12px'>
              <div className='max-w-620px'>
                <div className='flex items-center gap-8px'>
                  <Robot size={16} className='text-primary' />
                  <h2 className='m-0 text-15px font-semibold text-t-primary'>
                    {t('agentTasks.rdo.reportTitle', { defaultValue: 'Relatório estruturado do dia' })}
                  </h2>
                </div>
                <p className='mt-5px mb-0 text-11px leading-16px text-t-secondary'>
                  {t('agentTasks.rdo.reportHint', { defaultValue: 'Escolha um agente habilitado. Ele organiza os registros; não inventa informações nem substitui a conferência do responsável.' })}
                </p>
              </div>
              <div className='flex w-full flex-wrap gap-8px md:w-auto'>
                <Select className='min-w-210px flex-1' value={agentId ?? undefined} placeholder={t('agentTasks.rdo.agentPlaceholder', { defaultValue: 'Escolha um agente' })} onChange={setAgentId}>
                  {agents.map((agent) => <Select.Option key={agent.id} value={agent.id}>{agent.name}</Select.Option>)}
                </Select>
                <Button type='primary' icon={<Robot size={14} />} loading={reportBusy} disabled={!hasTaskApi || !agentId || !selectedEntry} onClick={() => void generateReport()}>
                  {selectedEntry?.report_task_id
                    ? t('agentTasks.rdo.regenerate', { defaultValue: 'Gerar novamente' })
                    : t('agentTasks.rdo.generate', { defaultValue: 'Gerar relatório' })}
                </Button>
              </div>
            </div>

            {!hasTaskApi ? (
              <div className='mt-12px rounded-8px bg-[var(--color-fill-2)] px-12px py-9px text-11px text-t-secondary'>
                {t('agentTasks.rdo.desktopOnly', { defaultValue: 'A geração por agente está disponível no app desktop. O preenchimento do diário pode ser feito pelo WebUI.' })}
              </div>
            ) : null}
            {!selectedEntry ? (
              <div className='mt-12px rounded-8px bg-[var(--color-fill-2)] px-12px py-9px text-11px text-t-secondary'>
                {t('agentTasks.rdo.saveBeforeReport', { defaultValue: 'Salve o diário antes de pedir a geração do relatório.' })}
              </div>
            ) : null}
            {reportError ? <p role='alert' className='mt-10px text-12px text-danger-6'>{reportError}</p> : null}
            {reportTask ? (
              <div className='mt-12px border-t border-solid border-[var(--color-border-2)] pt-12px'>
                <div className='mb-10px flex flex-wrap items-center gap-8px'>
                  <Tag color={reportTask.status === 'completed' ? 'green' : reportTask.status === 'failed' ? 'red' : 'arcoblue'}>
                    {statusLabel(reportTask, t)}
                  </Tag>
                  {reportIsStale ? <Tag color='orange'>{t('agentTasks.rdo.reportStale', { defaultValue: 'Diário alterado após a geração' })}</Tag> : null}
                </div>
                {reportTask.status === 'pending' || reportTask.status === 'running' ? (
                  <div className='flex items-center gap-8px py-12px text-12px text-t-secondary'><Spin size={16} />{t('agentTasks.rdo.generating', { defaultValue: 'O agente está organizando os dados do dia…' })}</div>
                ) : reportTask.status === 'failed' ? (
                  <p className='text-12px text-danger-6'>{reportTask.error || t('agentTasks.rdo.reportFailed', { defaultValue: 'O agente não conseguiu gerar o relatório.' })}</p>
                ) : reportTask.result ? (
                  <article className='max-h-560px overflow-y-auto rounded-8px bg-[var(--color-fill-2)] p-14px text-13px leading-20px text-t-primary'>
                    <ReactMarkdown>{reportTask.result}</ReactMarkdown>
                  </article>
                ) : (
                  <p className='text-12px text-t-secondary'>{t('agentTasks.rdo.noReport', { defaultValue: 'O agente concluiu sem retornar conteúdo.' })}</p>
                )}
              </div>
            ) : selectedEntry?.report_task_id ? (
              <p className='mt-12px text-11px text-t-tertiary'>{t('agentTasks.rdo.loadingReport', { defaultValue: 'Carregando o andamento do relatório…' })}</p>
            ) : null}
          </section>
        </section>
      </div>
    </main>
  );
};

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block min-w-0 text-12px text-t-secondary ${wide ? 'md:col-span-2' : ''}`}>
      {label}
      <div className='mt-5px'>{children}</div>
    </label>
  );
}

export default RdoPage;
