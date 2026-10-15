import type { Card, Deck, Grade, Language, Module, Note, NoteKind, QueueCounts, Scope, StudyCard } from '@naklearn/core';
import type { StudyDataSource } from '@naklearn/ui';

export interface ModuleOverview {
  moduleId: string; name: string; language: Language; examDate: string | null; newPerDay: number;
  total: number; new: number; learning: number; review: number; seenPct: number; dueToday: number;
  daysToExam: number | null; newTarget: number; warn: boolean;
}
export interface Overview { studiedToday: number; streak: number; modules: ModuleOverview[] }
export interface JobUsage {
  model: string | null; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; costUsd: number;
}
export interface Job {
  id: string; deckId: string; kind: 'render' | 'summary' | 'cards' | 'gaps' | 'translate' | 'chunk' | 'synthesis'; chunkFrom: number | null; chunkTo: number | null;
  status: 'queued' | 'running' | 'done' | 'failed'; attempts: number; error: string | null; usage: JobUsage | null; createdAt: number;
}
export interface WorkerStatus {
  state: 'idle' | 'running' | 'paused'; pauseReason: string | null; pausedUntil: number | null;
  current: { jobId: string; deckId: string; kind: Job['kind'] } | null; queued: number;
}
export interface Me { id: string; name: string; isAdmin: boolean }
export interface ModuleListItem { id: string; name: string; language: Language; memberCount: number; mine: boolean }
export interface DeviceInfo { id: string; name: string; createdAt: number; lastSeenAt: number | null }
export interface Person extends Me { createdAt: number; lastSeenAt: number | null; moduleCount: number; deviceCount: number }
export type DeckWithCount = Deck & { noteCount: number };
export type NoteListItem = Note & { deckTitle: string; cards: Card[] };

/** Nicht (mehr) angemeldet – die Oberfläche zeigt dann die Login-Seite. */
export class Unauthorized extends Error {}
const unauthorizedHandlers = new Set<() => void>();
export function onUnauthorized(fn: () => void): () => void {
  unauthorizedHandlers.add(fn);
  return () => {
    unauthorizedHandlers.delete(fn);
  };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (res.status === 401 && url !== '/api/login' && !url.startsWith('/api/invites/')) {
    for (const fn of unauthorizedHandlers) fn();
    throw new Unauthorized(body?.error ?? 'Nicht angemeldet');
  }
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
  login: (name: string, password: string) => request<Me>('/api/login', json('POST', { name, password })),
  me: () => request<Me>('/api/me'),
  changePassword: (old: string, next: string) => request<{ ok: true }>('/api/me/password', json('POST', { old, new: next })),
  devices: () => request<DeviceInfo[]>('/api/me/devices'),
  removeDevice: (id: string) => request<{ ok: true }>(`/api/me/devices/${id}`, { method: 'DELETE' }),
  allModules: () => request<ModuleListItem[]>('/api/modules/all'),
  joinModule: (id: string) => request<{ ok: true }>(`/api/modules/${id}/join`, { method: 'POST' }),
  leaveModule: (id: string) => request<{ ok: true }>(`/api/modules/${id}/leave`, { method: 'POST' }),
  invite: () => request<{ url: string }>('/api/invites', { method: 'POST' }),
  inviteInfo: (token: string) => request<{ kind: 'invite' | 'reset'; name: string | null }>(`/api/invites/${token}`),
  acceptInvite: (token: string, body: { name?: string; password: string }) =>
    request<Me>(`/api/invites/${token}/accept`, json('POST', body)),
  people: () => request<Person[]>('/api/users'),
  resetLink: (id: string) => request<{ url: string }>(`/api/users/${id}/reset`, { method: 'POST' }),
  deletePerson: (id: string) => request<{ ok: true }>(`/api/users/${id}`, { method: 'DELETE' }),
  logout: () => request<{ ok: true }>('/api/logout', { method: 'POST' }),
  overview: () => request<Overview>('/api/overview'),
  createModule: (m: { name: string; language: Language; examDate?: string | null; newPerDay?: number }) =>
    request<Module>('/api/modules', json('POST', m)),
  module: (id: string) => request<{ module: Module; decks: DeckWithCount[]; mine: boolean; memberCount: number }>(`/api/modules/${id}`),
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
  regenerate: (id: string, includeReviewed = false) =>
    request<{ ok: true }>(`/api/decks/${id}/regenerate`, json('POST', { includeReviewed })),
  fillGaps: (id: string) => request<{ ok: true }>(`/api/decks/${id}/gaps`, { method: 'POST' }),
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
  async deleteNote(noteId: string) {
    await api.deleteNote(noteId);
  }
  slideUrl(deckId: string, page: number) {
    return `/api/slides/${deckId}/${page}.jpg`;
  }
}
