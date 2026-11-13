import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { Button, DatePicker, Input, InputNumber, Message, Spin, Tag } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import type { CreateKanbanDailyLogInput, KanbanCard, KanbanDailyLog } from '@/common/kanban/kanbanTypes';
import { summarizeKanbanProduction } from '@/common/kanban/kanbanTypes';

type DailyLogDraft = {
  workDate: string;
  location: string;
  quantity: number | undefined;
  unit: string;
  crew: string;
  hours: number | undefined;
  equipment: string;
  occurrence: string;
};

function createDraft(card: KanbanCard): DailyLogDraft {
  return {
    workDate: dayjs().format('YYYY-MM-DD'),
    location: '',
    quantity: undefined,
    unit: card.quantity_unit ?? '',
    crew: card.assignee ?? '',
    hours: undefined,
    equipment: '',
    occurrence: '',
  };
}

function createIdempotencyKey(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `field-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

export function DailyLogSection({
  visible,
  card,
  onList,
  onCreate,
}: {
  visible: boolean;
  card: KanbanCard;
  onList: (cardId: string) => Promise<KanbanDailyLog[]>;
  onCreate: (input: CreateKanbanDailyLogInput) => Promise<KanbanDailyLog>;
}) {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<KanbanDailyLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<DailyLogDraft>(() => createDraft(card));
  const requestId = useRef(0);
  const pendingSubmission = useRef<{ fingerprint: string; key: string } | null>(null);
  const summary = useMemo(() => summarizeKanbanProduction(card.planned_quantity, logs), [card.planned_quantity, logs]);
  const hasContent =
    draft.quantity !== undefined ||
    draft.hours !== undefined ||
    Boolean(draft.location.trim()) ||
    Boolean(draft.crew.trim()) ||
    Boolean(draft.equipment.trim()) ||
    Boolean(draft.occurrence.trim());

  const reload = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true);
    try {
      const entries = await onList(card.id);
      if (request === requestId.current) setLogs(entries);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      Message.error(`${t('agentTasks.kanban.dailyLog.loadFailed')}: ${reason}`);
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [card.id, onList, t]);

  useEffect(() => {
    if (visible) void reload();
    else requestId.current += 1;
    return () => {
      requestId.current += 1;
    };
  }, [reload, visible]);

  const save = async () => {
    if (!hasContent) return;
    if (draft.quantity !== undefined && !draft.unit.trim()) {
      Message.error(t('agentTasks.kanban.dailyLog.unitRequired'));
      return;
    }
    const input: Omit<CreateKanbanDailyLogInput, 'idempotency_key'> = {
      card_id: card.id,
      work_date: draft.workDate,
      location: draft.location.trim() || null,
      quantity: draft.quantity ?? null,
      unit: draft.quantity === undefined ? null : draft.unit.trim(),
      crew: draft.crew.trim() || null,
      hours: draft.hours ?? null,
      equipment: draft.equipment.trim() || null,
      occurrence: draft.occurrence.trim() || null,
    };
    const fingerprint = JSON.stringify(input);
    if (pendingSubmission.current?.fingerprint !== fingerprint) {
      pendingSubmission.current = { fingerprint, key: createIdempotencyKey() };
    }
    const submission = pendingSubmission.current;
    setSaving(true);
    try {
      const saved = await onCreate({ ...input, idempotency_key: submission.key });
      setLogs((current) =>
        [...current.filter((entry) => entry.id !== saved.id), saved].toSorted(
          (left, right) => right.work_date.localeCompare(left.work_date) || right.created_at - left.created_at
        )
      );
      pendingSubmission.current = null;
      setDraft(createDraft(card));
      Message.success(t('agentTasks.kanban.dailyLog.saved'));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      Message.error(`${t('agentTasks.kanban.dailyLog.saveFailed')}: ${reason}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className='mt-16px border-t border-solid border-[var(--color-border-2)] pt-14px'>
      <div className='mb-10px flex items-center justify-between gap-8px'>
        <div>
          <h3 className='m-0 text-14px font-semibold text-t-primary'>{t('agentTasks.kanban.dailyLog.title')}</h3>
          <p className='mt-3px mb-0 text-11px leading-15px text-t-tertiary'>
            {t('agentTasks.kanban.dailyLog.immutableHint')}
          </p>
        </div>
        <Button
          type='text'
          size='small'
          icon={<Refresh size={14} />}
          loading={loading}
          aria-label={t('agentTasks.kanban.dailyLog.refresh')}
          onClick={() => void reload()}
        />
      </div>

      {card.planned_quantity !== null || summary.total_quantity > 0 ? (
        <div className='mb-12px rounded-8px bg-[var(--color-fill-2)] p-10px'>
          <div className='flex flex-wrap gap-6px'>
            <Tag color='blue'>
              {t('agentTasks.kanban.dailyLog.executed')}: {formatQuantity(summary.total_quantity)}
              {card.quantity_unit ? ` ${card.quantity_unit}` : ''}
            </Tag>
            {summary.remaining_quantity !== null ? (
              <Tag>
                {t('agentTasks.kanban.dailyLog.remaining')}: {formatQuantity(summary.remaining_quantity)}
                {card.quantity_unit ? ` ${card.quantity_unit}` : ''}
              </Tag>
            ) : null}
            {summary.progress_percent !== null ? (
              <Tag color={summary.progress_percent >= 100 ? 'green' : 'arcoblue'}>
                {t('agentTasks.kanban.dailyLog.progress')}: {formatQuantity(summary.progress_percent)}%
              </Tag>
            ) : null}
            {summary.average_per_day !== null && card.quantity_unit ? (
              <Tag>
                {t('agentTasks.kanban.dailyLog.average')}: {formatQuantity(summary.average_per_day)}{' '}
                {card.quantity_unit}/{t('agentTasks.kanban.dailyLog.day')}
              </Tag>
            ) : null}
            {summary.projected_work_days !== null ? (
              <Tag color='orange'>
                {t('agentTasks.kanban.dailyLog.projected')}: {formatQuantity(summary.projected_work_days)}{' '}
                {t('agentTasks.kanban.dailyLog.workDays')}
              </Tag>
            ) : null}
          </div>
          {summary.projected_work_days !== null ? (
            <p className='mt-6px mb-0 text-11px leading-15px text-t-tertiary'>
              {t('agentTasks.kanban.dailyLog.projectionHint', { count: summary.quantity_days })}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className='grid grid-cols-1 gap-8px sm:grid-cols-2'>
        <div>
          <label className='mb-4px block text-11px text-t-secondary'>{t('agentTasks.kanban.dailyLog.date')}</label>
          <DatePicker
            className='w-full'
            value={dayjs(draft.workDate)}
            onChange={(_value, date) =>
              setDraft((current) => ({ ...current, workDate: date ? date.format('YYYY-MM-DD') : current.workDate }))
            }
          />
        </div>
        <div className='sm:col-span-2'>
          <label className='mb-4px block text-11px text-t-secondary'>{t('agentTasks.kanban.dailyLog.location')}</label>
          <Input
            value={draft.location}
            placeholder={t('agentTasks.kanban.dailyLog.locationPlaceholder')}
            onChange={(value) => setDraft((current) => ({ ...current, location: value }))}
          />
        </div>
        <div>
          <label className='mb-4px block text-11px text-t-secondary'>{t('agentTasks.kanban.dailyLog.quantity')}</label>
          <div className='flex gap-6px'>
            <InputNumber
              className='min-w-0 flex-1'
              min={0}
              precision={3}
              value={draft.quantity}
              placeholder='0'
              onChange={(value) =>
                setDraft((current) => ({ ...current, quantity: typeof value === 'number' ? value : undefined }))
              }
            />
            <Input
              className='w-82px shrink-0'
              value={draft.unit}
              placeholder={t('agentTasks.kanban.dailyLog.unit')}
              onChange={(value) => setDraft((current) => ({ ...current, unit: value }))}
            />
          </div>
        </div>
        <div>
          <label className='mb-4px block text-11px text-t-secondary'>{t('agentTasks.kanban.dailyLog.crew')}</label>
          <Input value={draft.crew} onChange={(value) => setDraft((current) => ({ ...current, crew: value }))} />
        </div>
        <div>
          <label className='mb-4px block text-11px text-t-secondary'>{t('agentTasks.kanban.dailyLog.hours')}</label>
          <InputNumber
            className='w-full'
            min={0}
            max={24}
            precision={2}
            value={draft.hours}
            onChange={(value) =>
              setDraft((current) => ({ ...current, hours: typeof value === 'number' ? value : undefined }))
            }
          />
        </div>
        <div className='sm:col-span-2'>
          <label className='mb-4px block text-11px text-t-secondary'>{t('agentTasks.kanban.dailyLog.equipment')}</label>
          <Input
            value={draft.equipment}
            onChange={(value) => setDraft((current) => ({ ...current, equipment: value }))}
          />
        </div>
        <div className='sm:col-span-2'>
          <label className='mb-4px block text-11px text-t-secondary'>
            {t('agentTasks.kanban.dailyLog.occurrence')}
          </label>
          <Input.TextArea
            value={draft.occurrence}
            autoSize={{ minRows: 2, maxRows: 5 }}
            onChange={(value) => setDraft((current) => ({ ...current, occurrence: value }))}
          />
        </div>
      </div>
      <Button
        type='primary'
        long
        size='large'
        className='mt-10px min-h-44px'
        loading={saving}
        disabled={!hasContent || (draft.quantity !== undefined && !draft.unit.trim())}
        onClick={() => void save()}
      >
        {t('agentTasks.kanban.dailyLog.save')}
      </Button>

      <div className='mt-14px'>
        <div className='mb-6px text-12px font-medium text-t-secondary'>
          {t('agentTasks.kanban.dailyLog.history', { count: logs.length })}
        </div>
        {loading && logs.length === 0 ? (
          <div className='flex justify-center py-12px'>
            <Spin size={20} />
          </div>
        ) : logs.length === 0 ? (
          <p className='m-0 py-8px text-12px text-t-tertiary'>{t('agentTasks.kanban.dailyLog.empty')}</p>
        ) : (
          <ol className='m-0 max-h-220px list-none space-y-8px overflow-y-auto p-0'>
            {logs.map((entry) => (
              <li key={entry.id} className='rounded-8px border border-solid border-[var(--color-border-2)] p-8px'>
                <div className='flex flex-wrap items-center gap-6px'>
                  <Tag size='small' color='arcoblue'>
                    {dayjs(entry.work_date).format('DD/MM/YYYY')}
                  </Tag>
                  {entry.location ? <span className='text-11px text-t-secondary'>{entry.location}</span> : null}
                  {entry.quantity !== null ? (
                    <Tag size='small'>
                      {formatQuantity(entry.quantity)} {entry.unit}
                    </Tag>
                  ) : null}
                  {entry.hours !== null ? (
                    <Tag size='small'>
                      {formatQuantity(entry.hours)} {t('agentTasks.kanban.dailyLog.hoursShort')}
                    </Tag>
                  ) : null}
                  {entry.crew ? <span className='text-11px text-t-secondary'>{entry.crew}</span> : null}
                </div>
                {entry.equipment ? (
                  <p className='mt-5px mb-0 text-11px text-t-secondary'>
                    {t('agentTasks.kanban.dailyLog.equipment')}: {entry.equipment}
                  </p>
                ) : null}
                {entry.occurrence ? (
                  <p className='mt-5px mb-0 whitespace-pre-wrap text-12px leading-16px text-t-secondary'>
                    {entry.occurrence}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
