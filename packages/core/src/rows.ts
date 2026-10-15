import type { Card, Deck, Module, Note, RevlogEntry } from './types.ts';

// SQLite-Zeilen sind untypisiert; die Mapper sind die einzige Stelle, die snake_case kennt.
type Row = Record<string, any>;

export interface SlideRow {
  deckId: string;
  page: number;
  image: string;
}

export const toModule = (r: Row): Module => ({
  id: r.id, name: r.name, language: r.language, examDate: r.exam_date ?? null,
  newPerDay: r.new_per_day, deleted: !!r.deleted, updatedAt: r.updated_at,
});

export const toDeck = (r: Row): Deck => ({
  id: r.id, moduleId: r.module_id, title: r.title, pdfSha256: r.pdf_sha256, pageCount: r.page_count,
  status: r.status, error: r.error ?? null, summary: r.summary ?? null, position: r.position,
  deleted: !!r.deleted, updatedAt: r.updated_at,
});

export const toNote = (r: Row): Note => ({
  id: r.id, deckId: r.deck_id, kind: r.kind, front: r.front, back: r.back,
  slideRefs: JSON.parse(r.slide_refs), frontImagePage: r.front_image_page ?? null, tags: JSON.parse(r.tags),
  source: r.source, position: r.position, deleted: !!r.deleted, updatedAt: r.updated_at,
  frontDe: r.front_de ?? null, backDe: r.back_de ?? null,
});

export const toCard = (r: Row): Card => ({
  id: r.id, noteId: r.note_id, ordinal: r.ordinal, suspended: !!r.suspended, deleted: !!r.deleted, updatedAt: r.updated_at,
});

export const toRevlog = (r: Row): RevlogEntry => ({
  id: r.id, cardId: r.card_id, rating: r.rating, reviewedAt: r.reviewed_at, durationMs: r.duration_ms,
  deviceId: r.device_id, revokes: r.revokes ?? null,
});

export const toSlideRow = (r: Row): SlideRow => ({ deckId: r.deck_id, page: r.page, image: r.image });
