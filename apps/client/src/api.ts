import type { Card, Deck, Grade, Language, Module, Note, NoteKind, QueueCounts, Scope, StudyCard } from '@kartei/core';
import type { StudyDataSource } from '@kartei/ui';

export interface ModuleOverview {
  moduleId: string; name: string; language: Language; examDate: string | null; newPerDay: number;
  total: number; new: number; learning: number; review: number; seenPct: number; dueToday: number;
  daysToExam: number | null; newTarget: number; warn: boolean;
}
export interface Overview { studiedToday: number; streak: number; modules: ModuleOverview[] }
export interface Job {
  id: string; deckId: string; kind: 'render' | 'chunk' | 'synthesis'; chunkFrom: number | null; chunkTo: number | null;
  status: 'queued' | 'running' | 'done' | 'failed'; attempts: number; error: string | null; createdAt: number;
}
export interface WorkerStatus {
  state: 'idle' | 'running' | 'paused'; pauseReason: string | null; pausedUntil: number | null;
  current: { jobId: string; deckId: string; kind: Job['kind'] } | null; queued: number;
}
export type DeckWithCount = Deck & { noteCount: number };
export type NoteListItem = Note & { deckTitle: string; cards: Card[] };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

function qs(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const api = {
  overview: () => request<Overview>('/api/overview'),
  createModule: (m: { name: string; language: Language; examDate?: string | null; newPerDay?: number }) =>
    request<Module>('/api/modules', json('POST', m)),
  module: (id: string) => request<{ module: Module; decks: DeckWithCount[] }>(`/api/modules/${id}`),
  updateModule: (id: string, patch: Partial<Pick<Module, 'name' | 'language' | 'examDate' | 'newPerDay'>>) =>
    request<Module>(`/api/modules/${id}`, json('PATCH', patch)),
  deleteModule: (id: string) => request<{ ok: true }>(`/api/modules/${id}`, { method: 'DELETE' }),
  upload: (moduleId: string, files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    return request<{ created: Deck[]; skipped: { file: string; reason: string }[] }>(`/api/modules/${moduleId}/upload`, {
      method: 'POST',
      body: fd,
    });
  },
  deck: (id: string) => request<{ deck: Deck; jobs: Job[]; noteCount: number; moduleName: string }>(`/api/decks/${id}`),
  renameDeck: (id: string, title: string) => request<Deck>(`/api/decks/${id}`, json('PATCH', { title })),
  deleteDeck: (id: string) => request<{ ok: true }>(`/api/decks/${id}`, { method: 'DELETE' }),
  regenerate: (id: string) => request<{ ok: true }>(`/api/decks/${id}/regenerate`, { method: 'POST' }),
  retryJob: (id: string) => request<{ ok: true }>(`/api/jobs/${id}/retry`, { method: 'POST' }),
  worker: () => request<WorkerStatus>('/api/worker'),
  resumeWorker: () => request<{ ok: true }>('/api/worker/resume', { method: 'POST' }),
  notes: (f: { deckId?: string; moduleId?: string; q?: string; kind?: NoteKind }) =>
    request<NoteListItem[]>(`/api/notes${qs(f)}`),
  updateNote: (id: string, patch: { front?: string; back?: string; tags?: string[] }) =>
    request<{ note: Note; cards: Card[] }>(`/api/notes/${id}`, json('PATCH', patch)),
  deleteNote: (id: string) => request<{ ok: true }>(`/api/notes/${id}`, { method: 'DELETE' }),
  suspend: (cardId: string, suspended: boolean) =>
    request<{ ok: true }>(`/api/cards/${cardId}/suspend`, json('POST', { suspended })),
};

export class HttpDataSource implements StudyDataSource {
  next(scope: Scope) {
    return request<{ card: StudyCard | null; counts: QueueCounts }>(`/api/study/next${qs({ moduleId: scope.moduleId, deckId: scope.deckId })}`);
  }
  answer(cardId: string, rating: Grade, durationMs: number) {
    return request<{ revlogId: string }>('/api/study/answer', json('POST', { cardId, rating, durationMs }));
  }
  async undo(revlogId: string) {
    await request('/api/study/undo', json('POST', { revlogId }));
  }
  async setSuspended(cardId: string, suspended: boolean) {
    await api.suspend(cardId, suspended);
  }
  async updateNote(noteId: string, patch: { front: string; back: string }) {
    await api.updateNote(noteId, patch);
  }
  slideUrl(deckId: string, page: number) {
    return `/api/slides/${deckId}/${page}.jpg`;
  }
}
