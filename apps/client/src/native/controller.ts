import type { Grade, Scope } from '@naklearn/core';
import { syncStore, type LocalStore, type Transport } from '@naklearn/store';
import type { StudyDataSource } from '@naklearn/ui';
import { httpTransport } from './transport.ts';

export interface ImageStore {
  has(deckId: string, page: number): Promise<boolean>;
  download(url: string, token: string, deckId: string, page: number, image: string): Promise<void>;
  src(deckId: string, page: number): string;
}

export interface SyncState {
  phase: 'idle' | 'syncing' | 'error' | 'unpaired';
  message: string | null;
  lastSync: number | null;
  imagesMissing: number;
}

export class SyncController {
  state: SyncState = { phase: 'idle', message: null, lastSync: null, imagesMissing: 0 };
  private store: LocalStore;
  private images: ImageStore;
  private makeTransport: (url: string, token: string) => Transport;
  private listeners = new Set<(s: SyncState) => void>();
  private running: Promise<void> | null = null;

  constructor(store: LocalStore, images: ImageStore, makeTransport: (url: string, token: string) => Transport = httpTransport) {
    this.store = store;
    this.images = images;
    this.makeTransport = makeTransport;
  }

  subscribe(fn: (s: SyncState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  async pairing(): Promise<{ url: string; token: string } | null> {
    const url = await this.store.getMeta('server_url');
    const token = await this.store.getMeta('token');
    return url && token ? { url, token } : null;
  }

  async pair(url: string, token: string): Promise<void> {
    await this.store.setMeta('server_url', url.replace(/\/+$/, ''));
    await this.store.setMeta('token', token);
    await this.sync();
  }

  /** Synchronisiert und lädt fehlende Folienbilder; wirft nie, Fehler landen im Status. */
  sync(): Promise<void> {
    if (!this.running) this.running = this.doSync().finally(() => (this.running = null));
    return this.running;
  }

  private async doSync(): Promise<void> {
    const p = await this.pairing();
    const last = await this.store.getMeta('last_sync');
    if (!p) return this.set({ phase: 'unpaired', message: 'Noch nicht mit dem Laptop gekoppelt', lastSync: last ? Number(last) : null });
    this.set({ phase: 'syncing', message: null });
    try {
      await syncStore(this.store, this.makeTransport(p.url, p.token));
      let missing = 0;
      let failed = false;
      for (const s of await this.store.listSlides()) {
        if (await this.images.has(s.deckId, s.page)) continue;
        if (failed) {
          missing++;
          continue;
        }
        try {
          await this.images.download(p.url, p.token, s.deckId, s.page, s.image);
        } catch {
          // Server vermutlich weg: nicht jedes weitere Bild einzeln versuchen, Rest beim nächsten Sync.
          failed = true;
          missing++;
        }
      }
      const at = await this.store.getMeta('last_sync');
      this.set({ phase: 'idle', message: null, lastSync: at ? Number(at) : null, imagesMissing: missing });
    } catch (e) {
      this.set({ phase: 'error', message: String((e as Error).message ?? e) });
    }
  }
}

export class LocalDataSource implements StudyDataSource {
  private store: LocalStore;
  private images: ImageStore;
  constructor(store: LocalStore, images: ImageStore) {
    this.store = store;
    this.images = images;
  }
  next(scope: Scope) { return this.store.next(scope); }
  answer(cardId: string, rating: Grade, durationMs: number) { return this.store.answer(cardId, rating, durationMs); }
  undo(revlogId: string) { return this.store.undo(revlogId); }
  setSuspended(cardId: string, suspended: boolean) { return this.store.setSuspended(cardId, suspended); }
  updateNote(noteId: string, patch: { front: string; back: string }) { return this.store.updateNote(noteId, patch); }
  deleteNote(noteId: string) { return this.store.deleteNote(noteId); }
  slideUrl(deckId: string, page: number) { return this.images.src(deckId, page); }
}
