import type { Grade, Scope } from '@naklearn/core';
import { syncStore, type LocalStore, type Transport } from '@naklearn/store';
import type { ChatMessage, StudyDataSource } from '@naklearn/ui';
import { TokenRejected, askCard, deviceLogin, httpTransport } from './transport.ts';

export interface ImageStore {
  has(deckId: string, page: number): Promise<boolean>;
  download(url: string, token: string, deckId: string, page: number, image: string): Promise<void>;
  src(deckId: string, page: number): string;
  clear(): Promise<void>;
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
  private loginImpl: typeof deviceLogin;
  private listeners = new Set<(s: SyncState) => void>();
  private running: Promise<void> | null = null;

  constructor(
    store: LocalStore, images: ImageStore,
    makeTransport: (url: string, token: string) => Transport = httpTransport, loginImpl: typeof deviceLogin = deviceLogin,
  ) {
    this.store = store;
    this.images = images;
    this.makeTransport = makeTransport;
    this.loginImpl = loginImpl;
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

  async account(): Promise<{ url: string; token: string; name: string | null } | null> {
    const url = await this.store.getMeta('server_url');
    const token = await this.store.getMeta('token');
    return url && token ? { url, token, name: await this.store.getMeta('user_name') } : null;
  }

  /** Meldet das Handy an; bei anderer Person werden vorher die lokalen Daten gelöscht. Wirft bei Fehler. */
  async login(url: string, name: string, password: string): Promise<void> {
    const base = url.replace(/\/+$/, '');
    const r = await this.loginImpl(base, name, password, 'Android-Handy');
    const before = await this.store.getMeta('user_id');
    if (before && before !== r.user.id) {
      await this.store.wipe();
      await this.images.clear();
    }
    await this.store.setMeta('server_url', base);
    await this.store.setMeta('token', r.token);
    await this.store.setMeta('user_id', r.user.id);
    await this.store.setMeta('user_name', r.user.name);
    await this.sync();
  }

  /** Erst synchronisieren; gibt es danach noch Ungesynctes und `force` fehlt, nichts löschen. */
  async logout(force = false): Promise<{ unsynced: number }> {
    if (await this.account()) await this.sync();
    const unsynced = await this.store.unsyncedCount();
    if (unsynced > 0 && !force) return { unsynced };
    await this.store.wipe();
    await this.images.clear();
    this.set({ phase: 'unpaired', message: null, lastSync: null, imagesMissing: 0 });
    return { unsynced: 0 };
  }

  /** Synchronisiert und lädt fehlende Folienbilder; wirft nie, Fehler landen im Status. */
  sync(): Promise<void> {
    if (!this.running) this.running = this.doSync().finally(() => (this.running = null));
    return this.running;
  }

  private async doSync(): Promise<void> {
    const p = await this.account();
    const last = await this.store.getMeta('last_sync');
    if (!p) return this.set({ phase: 'unpaired', message: 'Nicht angemeldet', lastSync: last ? Number(last) : null });
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
      if (e instanceof TokenRejected) {
        await this.store.setMeta('token', '');
        return this.set({ phase: 'unpaired', message: e.message });
      }
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
  async ask(cardId: string, messages: ChatMessage[]) {
    const url = await this.store.getMeta('server_url');
    const token = await this.store.getMeta('token');
    if (!url || !token) throw new Error('Nicht angemeldet – bitte in den Einstellungen anmelden.');
    return askCard(url, token, cardId, messages);
  }
}
