import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { RunClaude } from './claude.ts';
import type { Db } from './db.ts';
import { NotFound } from './http.ts';
import { buildChatPrompt } from './prompt.ts';
import * as repo from './repo.ts';

export const MAX_CHAT_MESSAGES = 20;
export const MAX_QUESTION_CHARS = 2000;
export const MAX_ANSWER_CHARS = 8000;
export const MAX_PARALLEL_CHATS = 2;

export const ChatInput = z.object({
  messages: z
    .array(z.discriminatedUnion('role', [
      z.object({ role: z.literal('user'), content: z.string().trim().min(1).max(MAX_QUESTION_CHARS) }),
      z.object({ role: z.literal('assistant'), content: z.string().max(MAX_ANSWER_CHARS) }),
    ]))
    .min(1)
    .max(MAX_CHAT_MESSAGES)
    .refine((m) => m.at(-1)?.role === 'user', 'Die letzte Nachricht muss eine Frage sein'),
});
export type ChatMessage = z.infer<typeof ChatInput>['messages'][number];

export type ChatResult = { ok: true; answer: string } | { ok: false; status: number; error: string };

export interface Chat {
  ask(cardId: string, messages: ChatMessage[]): Promise<ChatResult>;
}

/** Fragen zu einer Karte, beantwortet über den Claude-Account des Servers. Hält keinen Verlauf. */
export function createChat(deps: { db: Db; dataDir: string; runClaude: RunClaude; model: string | null }): Chat {
  const { db, dataDir, runClaude, model } = deps;
  let running = 0;

  return {
    async ask(cardId, messages) {
      const card = repo.getCard(db, cardId);
      const note = card && repo.getNote(db, card.noteId);
      const deck = note && repo.getDeck(db, note.deckId);
      const mod = deck && repo.getModule(db, deck.moduleId);
      if (!card || !note || !deck || !mod) throw new NotFound('Karte nicht gefunden');
      if (running >= MAX_PARALLEL_CHATS) return { ok: false, status: 429, error: 'Gerade beschäftigt – bitte gleich noch einmal fragen.' };

      const slidesDir = path.join(dataDir, 'slides', deck.id);
      const slides = repo.listSlides(db, deck.id).filter((s) => note.slideRefs.includes(s.page));
      const prompt = buildChatPrompt({
        moduleName: mod.name,
        deckTitle: deck.title,
        note,
        slides: slides.map((s) => ({ page: s.page, text: s.text, imagePath: path.join(slidesDir, s.image) })),
        messages,
      });
      running++;
      const cwd = await mkdtemp(path.join(tmpdir(), 'naklearn-chat-'));
      try {
        const r = await runClaude({ prompt, addDirs: [slidesDir], cwd, model, timeoutMs: 90_000 }); // Cloudflare bricht nach 100 s ab
        if (r.ok) {
          const answer = String(r.output).trim();
          if (answer) return { ok: true, answer };
          return { ok: false, status: 502, error: 'Antwort fehlgeschlagen – bitte noch einmal fragen.' };
        }
        if (r.kind === 'auth') return { ok: false, status: 503, error: 'Claude-Token ungültig oder abgelaufen – Luna muss es auf dem Server erneuern.' };
        if (r.kind === 'rate_limit') return { ok: false, status: 429, error: 'Claude-Limit erreicht – bitte später noch einmal fragen.' };
        return { ok: false, status: 502, error: 'Antwort fehlgeschlagen – bitte noch einmal fragen.' };
      } finally {
        running--;
        await rm(cwd, { recursive: true, force: true });
      }
    },
  };
}
