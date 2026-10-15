import type { Grade, QueueCounts, Scope, StudyCard } from '@naklearn/core';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StudyDataSource {
  next(scope: Scope): Promise<{ card: StudyCard | null; counts: QueueCounts }>;
  answer(cardId: string, rating: Grade, durationMs: number): Promise<{ revlogId: string }>;
  undo(revlogId: string): Promise<void>;
  setSuspended(cardId: string, suspended: boolean): Promise<void>;
  updateNote(noteId: string, patch: { front: string; back: string }): Promise<void>;
  /** Löscht die Karte samt aller Lücken derselben Notiz. */
  deleteNote(noteId: string): Promise<void>;
  slideUrl(deckId: string, page: number): string;
  /** Fragt Claude zur Karte; `messages` ist der ganze Verlauf, die letzte Nachricht die Frage. Liefert die Antwort. */
  ask(cardId: string, messages: ChatMessage[]): Promise<string>;
}
