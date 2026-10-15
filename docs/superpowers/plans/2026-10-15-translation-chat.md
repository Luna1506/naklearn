# Übersetzung und KI-Chat pro Karte – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deutsche Fassung jeder Karte (offline, Umschalter) und KI-Chat pro Karte über Lunas Claude-Account.

**Architecture:** Zwei neue Note-Spalten, die nur der Server-Worker (Job `translate`, Sonnet) füllt und per Sync verteilt;
ein zustandsloser Endpunkt `POST /api/cards/:id/ask`, der `claude -p` im Textmodus aufruft. UI im gemeinsamen `StudyView`.

**Tech Stack:** TypeScript, node:sqlite, Fastify, React, Capacitor, vitest, `claude` CLI.

**Spec:** `docs/superpowers/specs/2026-10-15-translation-chat-design.md`

Ausführung: native in Lunas Sitzung (Luna: „baue alles und deploye“, ohne weitere Rückfragen).

## Global Constraints

- Bestehende Karten nie verändern außer den neuen Spalten; Usage sparsam (Sonnet, ein Aufruf pro Foliensatz).
- Alte Apps (≤ v0.3.1) müssen mit dem neuen Server weiter synchronisieren.
- Chat: max. 20 Nachrichten, Frage max. 2000 Zeichen, max. 2 parallele Aufrufe, Antwort auf Deutsch.
- `nix develop -c npm test` und `npm run typecheck` grün vor jedem Push.

## Review Focus

- Alte App pusht eine Note ohne `frontDe` → Übersetzung bleibt erhalten (Test in Task 1).
- Handy hat vor dem Update mit alter App synchronisiert → bekommt nach Update alle Übersetzungen (Cursor-Reset, Task 1).
- Text wird während der Übersetzung bearbeitet → keine veraltete Übersetzung geschrieben (Task 2).
- Lückentext-Übersetzung mit anderen Lücken → verworfen, keine Endlosschleife (Task 2).
- Chat bei abgelaufenem Token/Rate-Limit → verständliche Meldung statt Absturz (Task 3).

---

### Task 1: Datenmodell, Migration, Sync
**Files:** `packages/core/src/{migrations,types,rows,sync,render}.ts`, `packages/store/src/{sync,store}.ts`,
`apps/server/src/{repo,sync}.ts`, Tests in `packages/core/test`, `packages/store/test`, `apps/server/test`.
- [ ] Tests: Sync-Rundreise mit `frontDe`; Push ohne Felder behält Übersetzung; Push/Studio-Edit mit geändertem Text leert sie; Handy-Edit leert lokal; Migration löscht `sync_cursor`.
- [ ] Migration `ALTER TABLE note ADD COLUMN front_de/back_de; DELETE FROM meta WHERE key = 'sync_cursor'`.
- [ ] `Note.frontDe/backDe`, `toNote`, Sync-Schema optional → null, `StudyCard.frontDe/backDe` in `toStudyCard`.
- [ ] Store-Pull schreibt die Felder; Store-`updateNote` leert sie; Server-Push/`repo.updateNote` leeren bei Textänderung.
- [ ] Tests grün, Commit.

### Task 2: Übersetzungs-Job
**Files:** `apps/server/src/{generation,prompt}.ts`, `packages/core/src/schemas.ts`, `apps/server/test/{generation,prompt}.test.ts`, `apps/client/src/{api.ts,pages/DeckPage.tsx}`.
- [ ] Tests: übersetzt nur fehlende; Lückenprüfung; Guard bei paralleler Änderung; `de`-Modul übersprungen; kein Neu-Anstoßen ohne Änderung; seq steigt, updated_at nicht.
- [ ] `TranslationOutputSchema`, `buildTranslatePrompt`, `enqueueMissingTranslations`, `doTranslate`, Worker ruft Scan beim Start/untätig (≤ 1/min).
- [ ] Studio-Label „Übersetzen“. Tests grün, Commit.

### Task 3: Chat-Endpunkt
**Files:** `apps/server/src/{claude,prompt,chat,app}.ts`, `apps/server/test/{claude,chat}.test.ts`.
- [ ] Tests: Textmodus des Runners; Prompt enthält Karte, Übersetzung, Folientext, Verlauf; Grenzen (400); 2 parallel → 429; Auth-Fehler → 503, Rate-Limit → 429.
- [ ] `RunClaude` mit optionalem `jsonSchema` (Textmodus), `buildChatPrompt`, `askCard`, Route. Tests grün, Commit.

### Task 4: UI (Studio und App)
**Files:** `packages/ui/src/{StudyView.tsx,source.ts,CardChat.tsx,study.css}`, `apps/client/src/{api.ts,native/controller.ts,native/transport.ts}`.
- [ ] `StudyDataSource.ask`; HTTP- und Geräte-Implementierung (Fetch mit Bearer, Offline-Hinweis).
- [ ] EN/DE-Umschalter (Taste `t`, localStorage), „Frage stellen“ (Taste `f`), Chat-Komponente, Verlauf je Karte.
- [ ] Typecheck, Build, Commit.

### Task 5: Auslieferung
- [ ] Alle Tests, Typecheck, Build; Push auf `main`; CI abwarten; Server-Log prüfen, dass Übersetzungs-Jobs laufen.
- [ ] `nix develop -c npm run release minor` (v0.4.0).
