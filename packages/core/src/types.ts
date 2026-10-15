export type Language = 'en' | 'de';
export type NoteKind = 'qa' | 'cloze' | 'diagram';
export type NoteSource = 'chunk' | 'synthesis' | 'manual';
export type DeckStatus = 'pending' | 'rendering' | 'generating' | 'ready' | 'error';
export type Grade = 1 | 2 | 3 | 4;
/** 0 = Neu, 1 = Lernen, 2 = Wiederholung, 3 = Wiederlernen (wie ts-fsrs State). */
export type FsrsStateCode = 0 | 1 | 2 | 3;

export interface Module {
  id: string;
  name: string;
  language: Language;
  examDate: string | null; // YYYY-MM-DD
  newPerDay: number;
  deleted: boolean;
  updatedAt: number;
}

export interface Deck {
  id: string;
  moduleId: string;
  title: string;
  pdfSha256: string;
  pageCount: number;
  status: DeckStatus;
  error: string | null;
  /** Prüfungsorientierte Zusammenfassung (Markdown), Grundlage der Karten. */
  summary: string | null;
  position: number;
  deleted: boolean;
  updatedAt: number;
}

export interface Slide {
  deckId: string;
  page: number;
  text: string;
  image: string;
}

export interface Note {
  id: string;
  deckId: string;
  kind: NoteKind;
  front: string;
  back: string;
  slideRefs: number[];
  frontImagePage: number | null;
  tags: string[];
  source: NoteSource;
  position: number;
  deleted: boolean;
  updatedAt: number;
  /** Deutsche Fassung, null = (noch) nicht übersetzt. Schreibt nur der Server. */
  frontDe: string | null;
  backDe: string | null;
}

export interface Card {
  id: string;
  noteId: string;
  ordinal: number;
  suspended: boolean;
  deleted: boolean;
  updatedAt: number;
}

export interface RevlogEntry {
  id: string;
  cardId: string;
  /** 1–4 = Bewertung, 0 = Rücknahme-Eintrag (dann ist `revokes` gesetzt). */
  rating: 0 | Grade;
  reviewedAt: number;
  durationMs: number;
  deviceId: string;
  revokes: string | null;
}

export interface CardState {
  due: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  learningSteps: number;
  state: FsrsStateCode;
  lastReview: number | null;
}

export interface Scope {
  moduleId?: string;
  deckId?: string;
}

export interface QueueCounts {
  learning: number;
  review: number;
  new: number;
}

export interface StudyCard {
  cardId: string;
  noteId: string;
  deckId: string;
  kind: NoteKind;
  /** Fertiges Markdown der Vorderseite (bei Lücken bereits gerendert). */
  front: string;
  /** Fertiges Markdown der Rückseite. */
  back: string;
  /** Deutsche Fassung von `front`/`back`, null = nicht übersetzt. */
  frontDe: string | null;
  backDe: string | null;
  frontImagePage: number | null;
  slides: number[];
  moduleName: string;
  deckTitle: string;
  intervals: Record<Grade, string>;
  /** Rohinhalt der Note zum Bearbeiten. */
  noteFront: string;
  noteBack: string;
}
