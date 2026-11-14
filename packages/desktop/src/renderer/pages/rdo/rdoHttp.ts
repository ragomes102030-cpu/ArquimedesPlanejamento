import type { RdoAPI } from '@/common/rdo/rdoTypes';
import type { Task } from '@/common/task/taskTypes';

const FIELD_DESKTOP_ONLY = 'A geração do relatório por agente está disponível no aplicativo desktop.';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/rdo${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`RDO request failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  const payload: unknown = await response.json();
  return (typeof payload === 'object' && payload !== null && 'data' in payload ? payload.data : payload) as T;
}

export const rdoHttpApi: RdoAPI = {
  list: (boardId) => request(`/entries?board_id=${encodeURIComponent(boardId)}`),
  save: (input) => request('/entries', { method: 'POST', body: JSON.stringify(input) }),
  generateReport: (_input): Promise<Task> => Promise.reject(new Error(FIELD_DESKTOP_ONLY)),
};
