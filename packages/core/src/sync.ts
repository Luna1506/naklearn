import { z } from 'zod';
import type { SlideRow } from './rows.ts';
import type { Card, Deck, Module, Note, RevlogEntry } from './types.ts';

export const SYNC_PAGE_SIZE = 2000;

const ModuleRowSchema = z.object({
  id: z.string(), name: z.string(), language: z.enum(['en', 'de']), examDate: z.string().nullable(),
  newPerDay: z.number().int(), deleted: z.boolean(), updatedAt: z.number(),
});
const NoteRowSchema = z.object({
  id: z.string(), deckId: z.string(), kind: z.enum(['qa', 'cloze', 'diagram']), front: z.string(), back: z.string(),
  slideRefs: z.array(z.number().int()), frontImagePage: z.number().int().nullable(), tags: z.array(z.string()),
  source: z.enum(['chunk', 'synthesis', 'manual']), position: z.number(), deleted: z.boolean(), updatedAt: z.number(),
});
const CardRowSchema = z.object({
  id: z.string(), noteId: z.string(), ordinal: z.number().int(), suspended: z.boolean(), deleted: z.boolean(), updatedAt: z.number(),
});
const RevlogRowSchema = z.object({
  id: z.string(), cardId: z.string(), rating: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  reviewedAt: z.number(), durationMs: z.number().min(0), deviceId: z.string(), revokes: z.string().nullable(),
});

export const SyncRequestSchema = z.object({
  deviceId: z.string().min(1),
  cursor: z.number().int().min(0),
  push: z.object({
    modules: z.array(ModuleRowSchema),
    notes: z.array(NoteRowSchema),
    cards: z.array(CardRowSchema),
    revlog: z.array(RevlogRowSchema),
  }),
});

export interface SyncPush {
  modules: Module[];
  notes: Note[];
  cards: Card[];
  revlog: RevlogEntry[];
}

export interface SyncRequest {
  deviceId: string;
  cursor: number;
  push: SyncPush;
}

export interface SyncPull {
  modules: Module[];
  decks: Deck[];
  slides: SlideRow[];
  notes: Note[];
  cards: Card[];
  revlog: RevlogEntry[];
}

export interface SyncResponse {
  cursor: number;
  hasMore: boolean;
  pull: SyncPull;
}

export function emptyPush(): SyncPush {
  return { modules: [], notes: [], cards: [], revlog: [] };
}
