# kartei Teil 1 (Laptop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Laptop-Teil von kartei: PDFs hochladen, mit `claude -p` Lernkarten erzeugen, im Browser mit FSRS + Prüfungsmodus lernen; läuft als Home-Manager-systemd-Dienst.

**Architecture:** npm-Monorepo. `packages/core` enthält reine Domänenlogik (Typen, Lücken, FSRS-Replay, Prüfungsmodus, Stapel, Statistik, SQL-Migrationen). `apps/server` (Fastify, `node:sqlite`, läuft als TypeScript direkt unter Node 24) erledigt PDF-Aufbereitung, Job-Queue mit Claude-Aufrufen, REST-API und Auslieferung des Web-Clients. `packages/ui` enthält die Lernansicht (React) hinter dem Interface `StudyDataSource`, `apps/client` das Studio (Vite + React, Hash-Routing).

**Tech Stack:** Node 24 (Type Stripping, `node:sqlite`), TypeScript, ts-fsrs 5, zod 4, uuidv7, Fastify 5 (+ @fastify/multipart, @fastify/static), React 19, Vite 8, marked + DOMPurify, Vitest 5 (+ jsdom, Testing Library), poppler-utils, Nix (buildNpmPackage, Home Manager).

**Spec:** `docs/superpowers/specs/2026-10-06-kartei-design.md`

## Global Constraints

- Alle Befehle laufen in `~/projects/kartei` innerhalb von `nix develop -c …` (stellt Node 24 und poppler-utils bereit).
- TypeScript-Quellen werden ohne Build von Node ausgeführt: nur löschbare Syntax (keine `enum`, keine Parameter-Properties, kein `namespace`), relative Imports **mit** Endung `.ts`/`.tsx`, Typ-Imports mit `import type` bzw. `type`-Modifier.
- IDs sind UUIDv7 (`newId()` aus core).
- Lerntag beginnt um 04:00 Uhr lokaler Zeit; Tests laufen mit `TZ=Asia/Seoul`.
- FSRS: `request_retention 0.9`, `enable_fuzz true`, `enable_short_term true`, Lernschritte `1m, 10m`, Wiederlernschritt `10m`.
- Prüfungsmodus: Puffer 3 Tage, Warnschwelle 60 neue Karten/Tag; Learn-ahead 20 min; jede 4. Karte im Stapel ist neu.
- Server-Port 8742; Daten in `~/.local/share/kartei/{kartei.db, pdfs/<sha256>.pdf, slides/<deckId>/<page>.jpg, backups/, config.json}`.
- Loopback-Requests brauchen kein Token, alle anderen `Authorization: Bearer <token>`.
- Chunk-Größe 15 Folien; bis zu 2 Wiederholungen bei ungültigem JSON; Rate-Limit-Backoff 5/15/60 min; Claude-Timeout 10 min.
- Jede synchronisierbare Zeile trägt `seq` (globaler Zähler in `meta.seq`) und `updated_at`, damit Teil 2 (Sync) ohne Datenmigration auskommt.
- UI-Texte auf Deutsch. Kartensprache pro Modul (`en`/`de`).

## Review Focus

1. **Lernen nach Mitternacht (00:00–04:00):** zählt zum Vortag; das Kontingent neuer Karten setzt sich nicht um Mitternacht zurück → Tests in Task 2 (`studyDay`) und Task 4 (Kontingent).
2. **Claude liefert unsaubere Notes:** Foliennummern außerhalb des Decks, Lückentext ohne `{{c1::…}}`, Diagramm ohne gültige Seite → werden bereinigt statt abzustürzen → Test in Task 8.
3. **Server-Neustart während einer Erzeugung:** laufende Jobs gehen zurück in die Warteschlange und werden fortgesetzt → Test in Task 8.
4. **Upload derselben PDF bzw. einer Nicht-PDF:** wird mit Begründung übersprungen, der Rest läuft weiter → Test in Task 10.
5. **HTML/Script in Karteninhalten (von Claude oder Nutzerin):** wird beim Rendern bereinigt → Test in Task 11.

---

## File Structure

```
kartei/
├─ package.json                  Workspaces, Root-Skripte
├─ tsconfig.json                 Typecheck über alle Pakete
├─ flake.nix                     devShell, Paket, HM-Modul-Export
├─ nix/hm-module.nix             services.kartei
├─ packages/core/
│  ├─ package.json
│  ├─ src/index.ts               Re-Exports
│  ├─ src/types.ts               Domänentypen
│  ├─ src/ids.ts                 newId()
│  ├─ src/cloze.ts               Lücken parsen/rendern
│  ├─ src/render.ts              toStudyCard()
│  ├─ src/day.ts                 Lerntag-Arithmetik (04:00)
│  ├─ src/scheduler.ts           FSRS-Wrapper, Replay, Intervall-Vorschau
│  ├─ src/exam.ts                Prüfungs-Obergrenze, Neue-Karten-Kontingent
│  ├─ src/queue.ts               Stapelbildung, nächste Karte
│  ├─ src/stats.ts               Modulstatistik, Serie
│  ├─ src/schemas.ts             zod-Schemas der Claude-Ausgabe
│  ├─ src/migrations.ts          SQL-Migrationen
│  └─ test/*.test.ts
├─ apps/server/
│  ├─ package.json
│  ├─ src/main.ts                Einstiegspunkt
│  ├─ src/config.ts              Umgebung + config.json
│  ├─ src/db.ts                  node:sqlite, Migration, Transaktion
│  ├─ src/repo.ts                Datenzugriff
│  ├─ src/pdf.ts                 pdftoppm/pdftotext
│  ├─ src/claude.ts              claude -p Runner
│  ├─ src/prompt.ts              Prompts + JSON-Schemas
│  ├─ src/generation.ts          Job-Queue / Worker
│  ├─ src/study.ts               Lernen, Rückgängig, Statistik
│  ├─ src/backup.ts              tägliche Sicherung
│  ├─ src/app.ts                 Fastify-Routen
│  └─ test/…                     Tests, Fixtures (fake-claude.mjs, makePdf)
├─ packages/ui/
│  ├─ package.json, vitest.config.ts
│  ├─ src/index.ts, source.ts, Markdown.tsx, Lightbox.tsx, SlideStrip.tsx,
│  │  RatingBar.tsx, NoteEditor.tsx, StudyView.tsx, study.css
│  └─ test/*.test.tsx
└─ apps/client/
   ├─ package.json, vite.config.ts, index.html
   └─ src/main.tsx, router.ts, api.ts, styles.css,
      pages/Home.tsx, ModulePage.tsx, DeckPage.tsx, BrowserPage.tsx, StudyPage.tsx
```

---

### Task 1: Monorepo-Gerüst, Domänentypen, Lücken, Kartendarstellung

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `flake.nix`
- Create: `packages/core/package.json`, `packages/core/src/{index,types,ids,cloze,render}.ts`
- Test: `packages/core/test/cloze.test.ts`, `packages/core/test/render.test.ts`

**Interfaces:**
- Produces: alle Typen aus `types.ts` (s. u.), `newId(): string`, `clozeOrdinals(text: string): number[]`, `renderCloze(text: string, ordinal: number, side: 'front' | 'back'): string`, `toStudyCard(input: StudyCardInput): StudyCard`.

- [ ] **Step 1: Gerüst anlegen**

`package.json`:
```json
{
  "name": "kartei",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "typecheck": "tsc -p tsconfig.json",
    "dev:server": "npm run dev -w @kartei/server",
    "dev:client": "npm run dev -w @kartei/client",
    "build": "npm run build -w @kartei/client"
  },
  "devDependencies": {
    "@types/node": "^26.6.4",
    "typescript": "^7.0.2",
    "vitest": "^5.0.3"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["packages/*/src", "packages/*/test", "apps/*/src", "apps/*/test"]
}
```

`.gitignore`:
```
node_modules/
dist/
result
*.log
.vite/
```

`flake.nix` (Paket und HM-Modul folgen in Task 13):
```nix
{
  description = "kartei – Lernkarten aus Foliensätzen";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      devShells.${system}.default = pkgs.mkShell {
        packages = [ pkgs.nodejs_24 pkgs.poppler-utils pkgs.prefetch-npm-deps ];
      };
    };
}
```

`packages/core/package.json`:
```json
{
  "name": "@kartei/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "TZ=Asia/Seoul vitest run" }
}
```

Run: `git add -A && nix develop -c npm install -w @kartei/core ts-fsrs@^5.4.2 zod@^4.6.5 uuidv7@^1.2.1 && nix develop -c npm install`
Expected: `node_modules/@kartei/core` ist ein Symlink, kein Fehler.

- [ ] **Step 2: Typen und IDs schreiben**

`packages/core/src/types.ts`:
```ts
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
  frontImagePage: number | null;
  slides: number[];
  moduleName: string;
  deckTitle: string;
  intervals: Record<Grade, string>;
  /** Rohinhalt der Note zum Bearbeiten. */
  noteFront: string;
  noteBack: string;
}
```

`packages/core/src/ids.ts`:
```ts
import { uuidv7 } from 'uuidv7';

export function newId(): string {
  return uuidv7();
}
```

- [ ] **Step 3: Failing Tests für Lücken und Kartendarstellung**

`packages/core/test/cloze.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { clozeOrdinals, renderCloze } from '../src/cloze.ts';

describe('clozeOrdinals', () => {
  it('liefert sortierte, eindeutige Lücken-Nummern', () => {
    expect(clozeOrdinals('A {{c2::y}} B {{c1::x}} C {{c1::z}}')).toEqual([1, 2]);
  });
  it('liefert [] ohne Lücken', () => {
    expect(clozeOrdinals('kein Lückentext')).toEqual([]);
  });
});

describe('renderCloze', () => {
  const text = 'A {{c1::x}} B {{c2::y}} C {{c1::z}}';
  it('verdeckt auf der Vorderseite alle Stellen der aktiven Lücke', () => {
    expect(renderCloze(text, 1, 'front')).toBe(
      'A <span class="cloze">[…]</span> B y C <span class="cloze">[…]</span>',
    );
  });
  it('hebt auf der Rückseite nur die aktive Lücke hervor', () => {
    expect(renderCloze(text, 2, 'back')).toBe('A x B <span class="cloze-answer">y</span> C z');
  });
  it('zeigt einen Hinweis statt …', () => {
    expect(renderCloze('{{c1::Norman::Person}} schrieb das Buch', 1, 'front')).toBe(
      '<span class="cloze">[Person]</span> schrieb das Buch',
    );
  });
});
```

`packages/core/test/render.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { toStudyCard } from '../src/render.ts';
import type { Card, Note } from '../src/types.ts';

const baseNote: Note = {
  id: 'n1', deckId: 'd1', kind: 'qa', front: 'Was ist HCI?', back: 'Human-Computer Interaction …',
  slideRefs: [3, 4], frontImagePage: null, tags: [], source: 'chunk', position: 0, deleted: false, updatedAt: 0,
};
const card: Card = { id: 'c1', noteId: 'n1', ordinal: 0, suspended: false, deleted: false, updatedAt: 0 };
const intervals = { 1: '<10m', 2: '1d', 3: '3d', 4: '8d' } as const;

describe('toStudyCard', () => {
  it('übernimmt Frage/Antwort unverändert', () => {
    const sc = toStudyCard({ note: baseNote, card, moduleName: 'UIUX', deckTitle: 'Ch1', intervals });
    expect(sc.front).toBe('Was ist HCI?');
    expect(sc.back).toBe('Human-Computer Interaction …');
    expect(sc.slides).toEqual([3, 4]);
    expect(sc.noteFront).toBe('Was ist HCI?');
  });
  it('rendert Lückentext mit Zusatzerklärung', () => {
    const note: Note = { ...baseNote, kind: 'cloze', front: '{{c1::Norman}} prägte {{c2::Affordances}}', back: 'Extra' };
    const sc = toStudyCard({ note, card: { ...card, ordinal: 2 }, moduleName: 'UIUX', deckTitle: 'Ch1', intervals });
    expect(sc.front).toBe('Norman prägte <span class="cloze">[…]</span>');
    expect(sc.back).toBe('Norman prägte <span class="cloze-answer">Affordances</span>\n\n---\n\nExtra');
  });
  it('lässt die Trennlinie ohne Zusatzerklärung weg', () => {
    const note: Note = { ...baseNote, kind: 'cloze', front: '{{c1::A}}', back: '' };
    const sc = toStudyCard({ note, card: { ...card, ordinal: 1 }, moduleName: 'm', deckTitle: 'd', intervals });
    expect(sc.back).toBe('<span class="cloze-answer">A</span>');
  });
});
```

- [ ] **Step 4: Tests laufen lassen, Fehlschlag prüfen**

Run: `nix develop -c npm test -w @kartei/core`
Expected: FAIL – `Cannot find module '../src/cloze.ts'`.

- [ ] **Step 5: Implementierung**

`packages/core/src/cloze.ts`:
```ts
const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

export function clozeOrdinals(text: string): number[] {
  const set = new Set<number>();
  for (const m of text.matchAll(CLOZE_RE)) set.add(Number(m[1]));
  return [...set].sort((a, b) => a - b);
}

export function renderCloze(text: string, ordinal: number, side: 'front' | 'back'): string {
  return text.replace(CLOZE_RE, (_all, n: string, content: string, hint: string | undefined) => {
    if (Number(n) !== ordinal) return content;
    if (side === 'front') return `<span class="cloze">[${hint ?? '…'}]</span>`;
    return `<span class="cloze-answer">${content}</span>`;
  });
}
```

`packages/core/src/render.ts`:
```ts
import { renderCloze } from './cloze.ts';
import type { Card, Grade, Note, StudyCard } from './types.ts';

export interface StudyCardInput {
  note: Note;
  card: Card;
  moduleName: string;
  deckTitle: string;
  intervals: Record<Grade, string>;
}

export function toStudyCard({ note, card, moduleName, deckTitle, intervals }: StudyCardInput): StudyCard {
  let front = note.front;
  let back = note.back;
  if (note.kind === 'cloze') {
    front = renderCloze(note.front, card.ordinal, 'front');
    const full = renderCloze(note.front, card.ordinal, 'back');
    back = note.back.trim() ? `${full}\n\n---\n\n${note.back}` : full;
  }
  return {
    cardId: card.id,
    noteId: note.id,
    deckId: note.deckId,
    kind: note.kind,
    front,
    back,
    frontImagePage: note.kind === 'diagram' ? note.frontImagePage : null,
    slides: note.slideRefs,
    moduleName,
    deckTitle,
    intervals,
    noteFront: note.front,
    noteBack: note.back,
  };
}
```

`packages/core/src/index.ts`:
```ts
export * from './types.ts';
export * from './ids.ts';
export * from './cloze.ts';
export * from './render.ts';
```

- [ ] **Step 6: Tests laufen lassen**

Run: `nix develop -c npm test -w @kartei/core`
Expected: PASS (6 Tests).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): monorepo scaffold, domain types, cloze rendering"
```

---

### Task 2: Lerntag-Arithmetik und FSRS-Scheduler mit Replay

**Files:**
- Create: `packages/core/src/day.ts`, `packages/core/src/scheduler.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/day.test.ts`, `packages/core/test/scheduler.test.ts`

**Interfaces:**
- Consumes: `CardState`, `Grade`, `RevlogEntry` (Task 1).
- Produces:
  - `DAY_START_HOUR = 4`, `studyDay(ms: number): string`, `dayStartMs(day: string): number`, `addDays(day: string, n: number): string`, `daysBetween(from: string, to: string): number`
  - `emptyState(): CardState`, `applyReview(s: CardState, grade: Grade, at: number): CardState`, `effectiveLogs(logs: RevlogEntry[]): RevlogEntry[]`, `replay(logs: RevlogEntry[]): CardState`, `previewIntervals(s: CardState, now: number, dueOf?: (next: CardState) => number): Record<Grade, number>`, `formatInterval(ms: number): string`

- [ ] **Step 1: Failing Tests**

`packages/core/test/day.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { addDays, dayStartMs, daysBetween, studyDay } from '../src/day.ts';

describe('studyDay (TZ=Asia/Seoul, Tageswechsel 04:00)', () => {
  it('zählt 03:59 zum Vortag', () => {
    expect(studyDay(new Date('2026-10-06T03:59:00+09:00').getTime())).toBe('2026-10-05');
  });
  it('beginnt um 04:00 den neuen Tag', () => {
    expect(studyDay(new Date('2026-10-06T04:00:00+09:00').getTime())).toBe('2026-10-06');
  });
  it('dayStartMs liefert 04:00 lokale Zeit', () => {
    expect(dayStartMs('2026-10-06')).toBe(new Date('2026-10-06T04:00:00+09:00').getTime());
  });
  it('addDays über Monats- und Jahresgrenzen', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('daysBetween', () => {
    expect(daysBetween('2026-10-06', '2026-10-20')).toBe(14);
    expect(daysBetween('2026-10-20', '2026-10-06')).toBe(-14);
  });
});
```

`packages/core/test/scheduler.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { applyReview, emptyState, formatInterval, previewIntervals, replay } from '../src/scheduler.ts';
import type { Grade, RevlogEntry } from '../src/types.ts';

const T0 = new Date('2026-10-06T10:00:00+09:00').getTime();
const MIN = 60_000;
const DAY = 86_400_000;

function log(id: string, rating: 0 | Grade, at: number, revokes: string | null = null): RevlogEntry {
  return { id, cardId: 'c', rating, reviewedAt: at, durationMs: 1000, deviceId: 'dev', revokes };
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

describe('applyReview', () => {
  it('neue Karte: Nochmal → 1 min, Gut → 10 min (Lernschritte)', () => {
    expect(applyReview(emptyState(), 1, T0).due).toBe(T0 + MIN);
    const good = applyReview(emptyState(), 3, T0);
    expect(good.due).toBe(T0 + 10 * MIN);
    expect(good.state).toBe(1);
  });
  it('neue Karte: Einfach → direkt Wiederholung mit ≥ 1 Tag', () => {
    const s = applyReview(emptyState(), 4, T0);
    expect(s.state).toBe(2);
    expect(s.due - T0).toBeGreaterThanOrEqual(DAY);
  });
});

describe('replay', () => {
  it('ist unabhängig von der Ankunftsreihenfolge', () => {
    const r = rng(42);
    for (let run = 0; run < 25; run++) {
      const logs: RevlogEntry[] = [];
      let t = T0;
      for (let i = 0; i < 8; i++) {
        t += Math.floor(r() * 5 * DAY);
        logs.push(log(`l${run}-${i}`, (1 + Math.floor(r() * 4)) as Grade, t));
      }
      const shuffled = [...logs].sort(() => r() - 0.5);
      expect(replay(shuffled)).toEqual(replay(logs));
    }
  });
  it('ignoriert zurückgenommene Bewertungen', () => {
    const a = log('a', 3, T0);
    const b = log('b', 3, T0 + 10 * MIN);
    const undoB = log('u', 0, T0 + 11 * MIN, 'b');
    expect(replay([a, b, undoB])).toEqual(replay([a]));
  });
  it('ohne Einträge ist die Karte neu', () => {
    expect(replay([]).state).toBe(0);
  });
});

describe('previewIntervals', () => {
  it('zeigt die Lernschritte einer neuen Karte', () => {
    const p = previewIntervals(emptyState(), T0);
    expect(p[1]).toBe(MIN);
    expect(p[2]).toBe(6 * MIN);
    expect(p[3]).toBe(10 * MIN);
    expect(p[4]).toBeGreaterThanOrEqual(DAY);
  });
  it('nutzt eine angepasste Fälligkeit, wenn angegeben', () => {
    const p = previewIntervals(emptyState(), T0, () => T0 + 2 * DAY);
    expect(p[3]).toBe(2 * DAY);
  });
});

describe('formatInterval', () => {
  it.each([
    [30_000, '<1m'],
    [10 * MIN, '10m'],
    [3 * 60 * MIN, '3h'],
    [3 * DAY, '3d'],
    [45 * DAY, '1.5mo'],
    [400 * DAY, '1.1y'],
  ])('%i ms → %s', (ms, s) => {
    expect(formatInterval(ms)).toBe(s);
  });
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `nix develop -c npm test -w @kartei/core`
Expected: FAIL – Module `day.ts`/`scheduler.ts` fehlen.

- [ ] **Step 3: Implementierung**

`packages/core/src/day.ts`:
```ts
export const DAY_START_HOUR = 4;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parts(day: string): [number, number, number] {
  const [y, m, d] = day.split('-').map(Number);
  return [y!, m!, d!];
}

/** Lerntag (YYYY-MM-DD, lokale Zeit) eines Zeitpunkts; der Tag beginnt um 04:00. */
export function studyDay(ms: number): string {
  return fmt(new Date(ms - DAY_START_HOUR * 3_600_000));
}

/** Beginn eines Lerntags (04:00 lokale Zeit) in ms. */
export function dayStartMs(day: string): number {
  const [y, m, d] = parts(day);
  return new Date(y, m - 1, d, DAY_START_HOUR, 0, 0, 0).getTime();
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = parts(day);
  return fmt(new Date(y, m - 1, d + n, 12));
}

/** Anzahl Tage von `from` bis `to` (negativ, wenn `to` früher liegt). */
export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = parts(from);
  const [y2, m2, d2] = parts(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}
```

`packages/core/src/scheduler.ts`:
```ts
import { createEmptyCard, fsrs, generatorParameters, type Card as FsrsCard, type Grade as FsrsGrade } from 'ts-fsrs';
import type { CardState, FsrsStateCode, Grade, RevlogEntry } from './types.ts';

const scheduler = fsrs(
  generatorParameters({
    request_retention: 0.9,
    enable_fuzz: true,
    enable_short_term: true,
    learning_steps: ['1m', '10m'],
    relearning_steps: ['10m'],
  }),
);

function toFsrs(s: CardState): FsrsCard {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsedDays,
    scheduled_days: s.scheduledDays,
    reps: s.reps,
    lapses: s.lapses,
    learning_steps: s.learningSteps,
    state: s.state,
    last_review: s.lastReview === null ? undefined : new Date(s.lastReview),
  } as FsrsCard;
}

function fromFsrs(c: FsrsCard): CardState {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsedDays: c.elapsed_days,
    scheduledDays: c.scheduled_days,
    reps: c.reps,
    lapses: c.lapses,
    learningSteps: c.learning_steps,
    state: c.state as FsrsStateCode,
    lastReview: c.last_review ? c.last_review.getTime() : null,
  };
}

export function emptyState(): CardState {
  return fromFsrs(createEmptyCard(new Date(0)));
}

export function applyReview(s: CardState, grade: Grade, at: number): CardState {
  return fromFsrs(scheduler.next(toFsrs(s), new Date(at), grade as FsrsGrade).card);
}

/** Gültige Bewertungen (ohne Rücknahmen und Zurückgenommenes), deterministisch sortiert. */
export function effectiveLogs(logs: RevlogEntry[]): RevlogEntry[] {
  const revoked = new Set(logs.filter((l) => l.revokes !== null).map((l) => l.revokes));
  return logs
    .filter((l) => l.revokes === null && l.rating >= 1 && !revoked.has(l.id))
    .sort((a, b) => a.reviewedAt - b.reviewedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function replay(logs: RevlogEntry[]): CardState {
  return effectiveLogs(logs).reduce((s, l) => applyReview(s, l.rating as Grade, l.reviewedAt), emptyState());
}

export function previewIntervals(
  s: CardState,
  now: number,
  dueOf: (next: CardState) => number = (next) => next.due,
): Record<Grade, number> {
  const out = {} as Record<Grade, number>;
  for (const g of [1, 2, 3, 4] as const) out[g] = dueOf(applyReview(s, g, now)) - now;
  return out;
}

export function formatInterval(ms: number): string {
  const min = ms / 60_000;
  if (min < 1) return '<1m';
  if (min < 60) return `${Math.round(min)}m`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${(d / 30).toFixed(1)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}
```

`packages/core/src/index.ts` ergänzen:
```ts
export * from './day.ts';
export * from './scheduler.ts';
```

- [ ] **Step 4: Tests laufen lassen**

Run: `nix develop -c npm test -w @kartei/core`
Expected: PASS. Falls `p[2]` (Schwer) bei neuer Karte nicht `6 * MIN` ist: Wert von ts-fsrs übernehmen (dokumentiertes Verhalten: Mittel zwischen Schritt 1 und 2) und Test anpassen – nicht die Implementierung.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): study day arithmetic and FSRS replay scheduler"
```

---

### Task 3: Prüfungsmodus – Obergrenze und Neue-Karten-Kontingent

**Files:**
- Create: `packages/core/src/exam.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/exam.test.ts`

**Interfaces:**
- Consumes: `studyDay`, `dayStartMs`, `addDays`, `daysBetween` (Task 2), `CardState`.
- Produces:
  - `EXAM_BUFFER_DAYS = 3`, `NEW_PER_DAY_WARN = 60`
  - `hashString(s: string): number`
  - `effectiveDueMs(state: CardState, cardId: string, examDate: string | null, now: number): number`
  - `newCardLimit(o: { newPerDay: number; examDate: string | null; remainingNew: number; introducedToday: number; now: number }): { limit: number; target: number; warn: boolean }`

- [ ] **Step 1: Failing Tests**

`packages/core/test/exam.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { dayStartMs, studyDay } from '../src/day.ts';
import { effectiveDueMs, newCardLimit } from '../src/exam.ts';
import { emptyState } from '../src/scheduler.ts';
import type { CardState } from '../src/types.ts';

const at = (iso: string) => new Date(iso).getTime();
const NOW = at('2026-10-06T10:00:00+09:00');

function review(due: number, lastReview: number): CardState {
  return { ...emptyState(), state: 2, due, lastReview, stability: 30, reps: 3 };
}

describe('effectiveDueMs', () => {
  const far = review(at('2026-11-15T10:00:00+09:00'), NOW);

  it('ändert ohne Prüfungsdatum nichts', () => {
    expect(effectiveDueMs(far, 'c1', null, NOW)).toBe(far.due);
  });
  it('legt Karten nach der Prüfung auf einen der 3 Tage davor', () => {
    const allowed = ['2026-10-27', '2026-10-28', '2026-10-29'].map(dayStartMs);
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const d = effectiveDueMs(far, `card-${i}`, '2026-10-30', NOW);
      expect(allowed).toContain(d);
      seen.add(d);
    }
    expect(seen.size).toBe(3);
    expect(effectiveDueMs(far, 'card-7', '2026-10-30', NOW)).toBe(effectiveDueMs(far, 'card-7', '2026-10-30', NOW));
  });
  it('lässt Karten, die vor der Prüfung fällig sind, unverändert', () => {
    const s = review(at('2026-10-20T10:00:00+09:00'), NOW);
    expect(effectiveDueMs(s, 'c1', '2026-10-30', NOW)).toBe(s.due);
  });
  it('wirkt nicht mehr nach dem Prüfungstag', () => {
    const now = at('2026-10-31T10:00:00+09:00');
    const s = review(at('2026-11-20T10:00:00+09:00'), now);
    expect(effectiveDueMs(s, 'c1', '2026-10-30', now)).toBe(s.due);
  });
  it('zieht eine heute gelernte Karte nicht auf heute vor', () => {
    const now = at('2026-10-28T10:00:00+09:00');
    const s = review(at('2026-11-10T10:00:00+09:00'), now);
    const d = effectiveDueMs(s, 'card-x', '2026-10-30', now);
    expect(studyDay(d) > studyDay(now)).toBe(true);
    expect(d).toBe(dayStartMs('2026-10-29'));
  });
  it('lässt die Karte, wenn vor der Prüfung kein Tag mehr frei ist', () => {
    const now = at('2026-10-29T10:00:00+09:00');
    const s = review(at('2026-11-10T10:00:00+09:00'), now);
    expect(effectiveDueMs(s, 'c1', '2026-10-30', now)).toBe(s.due);
  });
  it('ignoriert neue Karten und Lernkarten', () => {
    expect(effectiveDueMs(emptyState(), 'c1', '2026-10-30', NOW)).toBe(emptyState().due);
  });
});

describe('newCardLimit', () => {
  it('ohne Prüfung: eingestellter Wert minus heute eingeführte', () => {
    expect(newCardLimit({ newPerDay: 20, examDate: null, remainingNew: 100, introducedToday: 5, now: NOW })).toEqual({
      limit: 15, target: 20, warn: false,
    });
  });
  it('mit Prüfung: verteilt bis 3 Tage vorher', () => {
    // 06.10. bis 27.10. = 22 Tage inklusive heute
    const base = { newPerDay: 20, examDate: '2026-10-30', introducedToday: 0, now: NOW };
    expect(newCardLimit({ ...base, remainingNew: 400 }).target).toBe(20);
    expect(newCardLimit({ ...base, remainingNew: 1000 }).target).toBe(46);
    expect(newCardLimit({ ...base, remainingNew: 2000 })).toEqual({ limit: 91, target: 91, warn: true });
  });
  it('bleibt über den Tag stabil (heute eingeführte zählen zum Gesamtbestand)', () => {
    const base = { newPerDay: 20, examDate: '2026-10-30', now: NOW };
    const morning = newCardLimit({ ...base, remainingNew: 1000, introducedToday: 0 });
    const later = newCardLimit({ ...base, remainingNew: 970, introducedToday: 30 });
    expect(later.target).toBe(morning.target);
    expect(later.limit).toBe(morning.target - 30);
  });
  it('begrenzt auf den Rest', () => {
    expect(newCardLimit({ newPerDay: 20, examDate: null, remainingNew: 3, introducedToday: 0, now: NOW }).limit).toBe(3);
  });
  it('nach Ablauf des Puffers: alles Verbleibende sofort', () => {
    const now = at('2026-10-28T10:00:00+09:00');
    expect(newCardLimit({ newPerDay: 20, examDate: '2026-10-30', remainingNew: 150, introducedToday: 0, now }).target).toBe(150);
  });
  it('nach der Prüfung: normaler Wert', () => {
    const now = at('2026-11-02T10:00:00+09:00');
    expect(newCardLimit({ newPerDay: 20, examDate: '2026-10-30', remainingNew: 500, introducedToday: 0, now }).target).toBe(20);
  });
  it('zählt nach Mitternacht noch zum Vortag (kein neues Kontingent um 00:00)', () => {
    const lateNight = at('2026-10-07T01:30:00+09:00'); // Lerntag 06.10.
    expect(newCardLimit({ newPerDay: 20, examDate: null, remainingNew: 100, introducedToday: 20, now: lateNight }).limit).toBe(0);
  });
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `nix develop -c npm test -w @kartei/core`
Expected: FAIL – `exam.ts` fehlt.

- [ ] **Step 3: Implementierung**

`packages/core/src/exam.ts`:
```ts
import { addDays, dayStartMs, daysBetween, studyDay } from './day.ts';
import type { CardState } from './types.ts';

export const EXAM_BUFFER_DAYS = 3;
export const NEW_PER_DAY_WARN = 60;

/** FNV-1a, 32 Bit. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Fälligkeit unter Berücksichtigung des Prüfungsdatums: Wiederholungskarten, die erst
 * am Prüfungstag oder danach fällig wären, landen auf einem der 3 Tage davor.
 */
export function effectiveDueMs(state: CardState, cardId: string, examDate: string | null, now: number): number {
  if (!examDate || state.state !== 2) return state.due;
  const today = studyDay(now);
  if (daysBetween(today, examDate) <= 0) return state.due;
  if (studyDay(state.due) < examDate) return state.due;

  let target = addDays(examDate, -(1 + (hashString(cardId) % EXAM_BUFFER_DAYS)));
  if (state.lastReview !== null) {
    const earliest = addDays(studyDay(state.lastReview), 1);
    if (target < earliest) target = earliest;
  }
  if (target >= examDate) return state.due;
  return dayStartMs(target);
}

export function newCardLimit(o: {
  newPerDay: number;
  examDate: string | null;
  remainingNew: number;
  introducedToday: number;
  now: number;
}): { limit: number; target: number; warn: boolean } {
  let target = o.newPerDay;
  if (o.examDate) {
    const today = studyDay(o.now);
    if (daysBetween(today, o.examDate) > 0) {
      const deadline = addDays(o.examDate, -EXAM_BUFFER_DAYS);
      const days = Math.max(1, daysBetween(today, deadline) + 1);
      target = Math.max(o.newPerDay, Math.ceil((o.remainingNew + o.introducedToday) / days));
    }
  }
  const limit = Math.max(0, Math.min(o.remainingNew, target - o.introducedToday));
  return { limit, target, warn: target > NEW_PER_DAY_WARN };
}
```

`packages/core/src/index.ts` ergänzen: `export * from './exam.ts';`

- [ ] **Step 4: Tests laufen lassen**

Run: `nix develop -c npm test -w @kartei/core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): exam mode interval cap and new-card quota"
```

---

### Task 4: Stapelbildung und Statistik

**Files:**
- Create: `packages/core/src/queue.ts`, `packages/core/src/stats.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/queue.test.ts`, `packages/core/test/stats.test.ts`

**Interfaces:**
- Consumes: `effectiveDueMs`, `newCardLimit`, `studyDay`, `dayStartMs`, `addDays`, `daysBetween`, `CardState`, `Scope`, `QueueCounts`.
- Produces:
  - `interface QueueCard { cardId: string; noteId: string; deckId: string; moduleId: string; sortKey: [number, number, number]; state: CardState; firstReviewedAt: number | null; suspended: boolean }`
  - `interface QueueModule { id: string; examDate: string | null; newPerDay: number }`
  - `LEARN_AHEAD_MS = 1_200_000`, `NEW_EVERY = 4`
  - `buildQueue(cards: QueueCard[], modules: QueueModule[], scope: Scope, now: number): { learning: QueueCard[]; review: QueueCard[]; fresh: QueueCard[] }`
  - `nextCard(cards, modules, scope, now): { next: QueueCard | null; counts: QueueCounts }`
  - `interface ModuleStats { moduleId: string; total: number; new: number; learning: number; review: number; seenPct: number; dueToday: number; daysToExam: number | null; newTarget: number; warn: boolean }`
  - `moduleStats(cards: QueueCard[], mod: QueueModule, now: number): ModuleStats`
  - `streak(reviewTimes: number[], now: number): number`

- [ ] **Step 1: Failing Tests**

`packages/core/test/queue.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { nextCard, buildQueue, type QueueCard, type QueueModule } from '../src/queue.ts';
import { emptyState } from '../src/scheduler.ts';
import type { CardState } from '../src/types.ts';

const at = (iso: string) => new Date(iso).getTime();
const NOW = at('2026-10-06T10:00:00+09:00');
const MIN = 60_000;
const DAY = 86_400_000;

const mod: QueueModule = { id: 'm1', examDate: null, newPerDay: 20 };

function qc(id: string, patch: Partial<QueueCard> = {}, state: Partial<CardState> = {}): QueueCard {
  return {
    cardId: id, noteId: `n-${id}`, deckId: 'd1', moduleId: 'm1', sortKey: [1, 0, 0],
    state: { ...emptyState(), ...state }, firstReviewedAt: null, suspended: false, ...patch,
  };
}
const learning = (id: string, due: number) => qc(id, { firstReviewedAt: NOW - 5 * MIN }, { state: 1, due, lastReview: NOW - 5 * MIN });
const review = (id: string, due: number, extra: Partial<QueueCard> = {}) =>
  qc(id, { firstReviewedAt: NOW - 10 * DAY, ...extra }, { state: 2, due, lastReview: NOW - 5 * DAY, stability: 5 });
const fresh = (id: string, pos: number, extra: Partial<QueueCard> = {}) => qc(id, { sortKey: [1, pos, 0], ...extra });

describe('nextCard', () => {
  it('zeigt fällige Lernkarten zuerst', () => {
    const cards = [review('r1', NOW - DAY), learning('l1', NOW - MIN), fresh('f1', 1)];
    expect(nextCard(cards, [mod], {}, NOW).next?.cardId).toBe('l1');
  });
  it('mischt jede 4. Karte als neue Karte', () => {
    const cards = [
      ...[1, 2, 3, 4, 5, 6].map((i) => review(`r${i}`, NOW - i * MIN)),
      fresh('f1', 1), fresh('f2', 2),
    ];
    const q = buildQueue(cards, [mod], {}, NOW);
    expect(q.review).toHaveLength(6);
    expect(q.fresh.map((c) => c.cardId)).toEqual(['f1', 'f2']);
    // Reihenfolge prüfen, indem wir jede gezeigte Karte als heute beantwortet markieren
    const order: string[] = [];
    let rest = cards;
    for (let i = 0; i < 8; i++) {
      const n = nextCard(rest, [mod], {}, NOW).next!;
      order.push(n.cardId[0]!);
      rest = rest.map((c) =>
        c.cardId !== n.cardId
          ? c
          : { ...c, firstReviewedAt: c.firstReviewedAt ?? NOW, state: { ...c.state, state: 2, due: NOW + 3 * DAY, lastReview: NOW } },
      );
    }
    expect(order.join('')).toBe('rrrfrrrf');
  });
  it('begrenzt neue Karten auf das Tageskontingent', () => {
    const cards = [
      ...Array.from({ length: 30 }, (_, i) => fresh(`f${i}`, i)),
      ...Array.from({ length: 5 }, (_, i) => review(`x${i}`, NOW + 2 * DAY, { firstReviewedAt: NOW - MIN })),
    ];
    const q = buildQueue(cards, [mod], {}, NOW);
    expect(q.fresh).toHaveLength(15); // 20 − 5 heute eingeführte
    expect(q.fresh[0]!.cardId).toBe('f0');
  });
  it('vergräbt Geschwister einer heute gelernten Note', () => {
    const a = review('a', NOW + 3 * DAY, { noteId: 'n1' });
    a.state.lastReview = NOW - MIN;
    const b = fresh('b', 1, { noteId: 'n1' });
    expect(buildQueue([a, b], [mod], {}, NOW).fresh).toHaveLength(0);
  });
  it('filtert nach Foliensatz', () => {
    const cards = [fresh('f1', 1, { deckId: 'd1' }), fresh('f2', 2, { deckId: 'd2' })];
    expect(buildQueue(cards, [mod], { deckId: 'd2' }, NOW).fresh.map((c) => c.cardId)).toEqual(['f2']);
  });
  it('Learn-ahead: Lernkarte in 15 min wird gezeigt, in 30 min nicht', () => {
    expect(nextCard([learning('l1', NOW + 15 * MIN)], [mod], {}, NOW).next?.cardId).toBe('l1');
    expect(nextCard([learning('l1', NOW + 30 * MIN)], [mod], {}, NOW).next).toBeNull();
  });
  it('Wiederholungen des Moduls mit näherer Prüfung zuerst', () => {
    const near: QueueModule = { id: 'm2', examDate: '2026-10-10', newPerDay: 20 };
    const cards = [review('r1', NOW - 5 * DAY), review('r2', NOW - MIN, { moduleId: 'm2' })];
    expect(nextCard(cards, [mod, near], {}, NOW).next?.cardId).toBe('r2');
  });
  it('lässt pausierte Karten weg und zählt korrekt', () => {
    const cards = [fresh('f1', 1, { suspended: true }), review('r1', NOW - MIN), learning('l1', NOW + 5 * MIN)];
    expect(nextCard(cards, [mod], {}, NOW).counts).toEqual({ learning: 1, review: 1, new: 0 });
  });
  it('nach Mitternacht kein neues Kontingent', () => {
    const lateNight = at('2026-10-07T01:00:00+09:00');
    const introduced = Array.from({ length: 20 }, (_, i) =>
      review(`i${i}`, lateNight + 3 * DAY, { firstReviewedAt: at('2026-10-06T20:00:00+09:00') }),
    );
    const cards = [...introduced, fresh('f1', 1)];
    expect(buildQueue(cards, [mod], {}, lateNight).fresh).toHaveLength(0);
  });
});
```

`packages/core/test/stats.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { moduleStats, streak } from '../src/stats.ts';
import { emptyState } from '../src/scheduler.ts';
import type { QueueCard } from '../src/queue.ts';

const at = (iso: string) => new Date(iso).getTime();
const NOW = at('2026-10-06T10:00:00+09:00');
const DAY = 86_400_000;

function card(id: string, state: 0 | 1 | 2): QueueCard {
  return {
    cardId: id, noteId: id, deckId: 'd', moduleId: 'm', sortKey: [0, 0, 0],
    state: { ...emptyState(), state, due: NOW + DAY, lastReview: state ? NOW - DAY : null },
    firstReviewedAt: state ? NOW - 2 * DAY : null, suspended: false,
  };
}

describe('moduleStats', () => {
  it('zählt Zustände und Anteil gesehener Karten', () => {
    const cards = [card('a', 0), card('b', 0), card('c', 1), card('d', 2)];
    const s = moduleStats(cards, { id: 'm', examDate: '2026-10-30', newPerDay: 20 }, NOW);
    expect(s).toMatchObject({ total: 4, new: 2, learning: 1, review: 1, seenPct: 50, daysToExam: 24 });
    expect(s.dueToday).toBe(2); // 2 neue, Lern-/Wiederholungskarte erst morgen
  });
});

describe('streak', () => {
  const d = (n: number) => NOW - n * DAY;
  it('zählt aufeinanderfolgende Tage bis heute', () => {
    expect(streak([d(0), d(1), d(1), d(2)], NOW)).toBe(3);
  });
  it('zählt bis gestern, wenn heute noch nichts gelernt wurde', () => {
    expect(streak([d(1), d(2)], NOW)).toBe(2);
  });
  it('ist 0 nach einer Lücke', () => {
    expect(streak([d(3)], NOW)).toBe(0);
  });
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `nix develop -c npm test -w @kartei/core`
Expected: FAIL – `queue.ts`/`stats.ts` fehlen.

- [ ] **Step 3: Implementierung**

`packages/core/src/queue.ts`:
```ts
import { addDays, dayStartMs, daysBetween, studyDay } from './day.ts';
import { effectiveDueMs, newCardLimit } from './exam.ts';
import type { CardState, QueueCounts, Scope } from './types.ts';

export interface QueueCard {
  cardId: string;
  noteId: string;
  deckId: string;
  moduleId: string;
  /** deck.position, note.position, card.ordinal */
  sortKey: [number, number, number];
  state: CardState;
  firstReviewedAt: number | null;
  suspended: boolean;
}

export interface QueueModule {
  id: string;
  examDate: string | null;
  newPerDay: number;
}

export const LEARN_AHEAD_MS = 20 * 60_000;
export const NEW_EVERY = 4;

function examRank(mod: QueueModule, today: string): number {
  if (!mod.examDate) return Number.POSITIVE_INFINITY;
  const d = daysBetween(today, mod.examDate);
  return d > 0 ? d : Number.POSITIVE_INFINITY;
}

function compareKeys(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function buildQueue(
  cards: QueueCard[],
  modules: QueueModule[],
  scope: Scope,
  now: number,
): { learning: QueueCard[]; review: QueueCard[]; fresh: QueueCard[] } {
  const today = studyDay(now);
  const tomorrowStart = dayStartMs(addDays(today, 1));
  const modById = new Map(modules.map((m) => [m.id, m]));
  const active = cards.filter((c) => !c.suspended && modById.has(c.moduleId));

  const reviewedToday = new Map<string, Set<string>>();
  for (const c of active) {
    if (c.state.lastReview !== null && studyDay(c.state.lastReview) === today) {
      const set = reviewedToday.get(c.noteId) ?? new Set<string>();
      set.add(c.cardId);
      reviewedToday.set(c.noteId, set);
    }
  }
  const buried = (c: QueueCard) =>
    (c.state.state === 0 || c.state.state === 2) &&
    [...(reviewedToday.get(c.noteId) ?? [])].some((id) => id !== c.cardId);
  const inScope = (c: QueueCard) =>
    (!scope.moduleId || c.moduleId === scope.moduleId) && (!scope.deckId || c.deckId === scope.deckId);

  const learning = active
    .filter((c) => (c.state.state === 1 || c.state.state === 3) && inScope(c) && c.state.due <= now + LEARN_AHEAD_MS)
    .sort((a, b) => a.state.due - b.state.due);

  const review = active
    .filter((c) => c.state.state === 2 && inScope(c) && !buried(c))
    .map((c) => ({ c, due: effectiveDueMs(c.state, c.cardId, modById.get(c.moduleId)!.examDate, now) }))
    .filter((x) => x.due < tomorrowStart)
    .sort(
      (a, b) =>
        examRank(modById.get(a.c.moduleId)!, today) - examRank(modById.get(b.c.moduleId)!, today) || a.due - b.due,
    )
    .map((x) => x.c);

  const fresh: QueueCard[] = [];
  const sortedModules = [...modules].sort((a, b) => examRank(a, today) - examRank(b, today));
  for (const mod of sortedModules) {
    const modCards = active.filter((c) => c.moduleId === mod.id);
    const remainingNew = modCards.filter((c) => c.state.state === 0).length;
    const introducedToday = modCards.filter(
      (c) => c.firstReviewedAt !== null && studyDay(c.firstReviewedAt) === today,
    ).length;
    const { limit } = newCardLimit({ newPerDay: mod.newPerDay, examDate: mod.examDate, remainingNew, introducedToday, now });
    const candidates = modCards
      .filter((c) => c.state.state === 0 && inScope(c) && !buried(c))
      .sort((a, b) => compareKeys(a.sortKey, b.sortKey));
    fresh.push(...candidates.slice(0, limit));
  }

  return { learning, review, fresh };
}

/**
 * Jede NEW_EVERY-te Karte ist neu: Eine neue Karte kommt dran, sobald heute (im Scope)
 * mindestens (neu_heute + 1) × (NEW_EVERY − 1) Wiederholungen beantwortet wurden.
 * Zustandsbasiert, damit das Muster auch beim Neuaufbau nach jeder Antwort stimmt.
 */
function preferNew(cards: QueueCard[], scope: Scope, now: number): boolean {
  const today = studyDay(now);
  const inScope = (c: QueueCard) =>
    (!scope.moduleId || c.moduleId === scope.moduleId) && (!scope.deckId || c.deckId === scope.deckId);
  let reviewsDone = 0;
  let newDone = 0;
  for (const c of cards) {
    if (!inScope(c) || c.firstReviewedAt === null) continue;
    if (studyDay(c.firstReviewedAt) === today) newDone++;
    else if (c.state.lastReview !== null && studyDay(c.state.lastReview) === today) reviewsDone++;
  }
  return reviewsDone >= (newDone + 1) * (NEW_EVERY - 1);
}

export function nextCard(
  cards: QueueCard[],
  modules: QueueModule[],
  scope: Scope,
  now: number,
): { next: QueueCard | null; counts: QueueCounts } {
  const q = buildQueue(cards, modules, scope, now);
  const dueLearning = q.learning.filter((c) => c.state.due <= now);
  let next: QueueCard | null = dueLearning[0] ?? null;
  if (!next) {
    const takeNew = q.fresh.length > 0 && (q.review.length === 0 || preferNew(cards, scope, now));
    next = (takeNew ? q.fresh[0] : q.review[0]) ?? q.fresh[0] ?? q.learning[0] ?? null;
  }
  return { next, counts: { learning: q.learning.length, review: q.review.length, new: q.fresh.length } };
}
```

`packages/core/src/stats.ts`:
```ts
import { addDays, daysBetween, studyDay } from './day.ts';
import { newCardLimit } from './exam.ts';
import { buildQueue, type QueueCard, type QueueModule } from './queue.ts';

export interface ModuleStats {
  moduleId: string;
  total: number;
  new: number;
  learning: number;
  review: number;
  seenPct: number;
  dueToday: number;
  daysToExam: number | null;
  newTarget: number;
  warn: boolean;
}

export function moduleStats(cards: QueueCard[], mod: QueueModule, now: number): ModuleStats {
  const mine = cards.filter((c) => c.moduleId === mod.id && !c.suspended);
  const count = (s: number) => mine.filter((c) => c.state.state === s).length;
  const isNew = count(0);
  const learning = count(1) + count(3);
  const review = count(2);
  const q = buildQueue(mine, [mod], { moduleId: mod.id }, now);
  const today = studyDay(now);
  const introducedToday = mine.filter((c) => c.firstReviewedAt !== null && studyDay(c.firstReviewedAt) === today).length;
  const quota = newCardLimit({ newPerDay: mod.newPerDay, examDate: mod.examDate, remainingNew: isNew, introducedToday, now });
  const daysToExam = mod.examDate ? daysBetween(today, mod.examDate) : null;
  return {
    moduleId: mod.id,
    total: mine.length,
    new: isNew,
    learning,
    review,
    seenPct: mine.length ? Math.round(((mine.length - isNew) / mine.length) * 100) : 0,
    dueToday: q.learning.length + q.review.length + q.fresh.length,
    daysToExam: daysToExam !== null && daysToExam >= 0 ? daysToExam : null,
    newTarget: quota.target,
    warn: quota.warn && isNew > 0,
  };
}

export function streak(reviewTimes: number[], now: number): number {
  const days = new Set(reviewTimes.map(studyDay));
  let day = studyDay(now);
  if (!days.has(day)) day = addDays(day, -1);
  let n = 0;
  while (days.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}
```

`packages/core/src/index.ts` ergänzen:
```ts
export * from './queue.ts';
export * from './stats.ts';
```

- [ ] **Step 4: Tests laufen lassen**

Run: `nix develop -c npm test -w @kartei/core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): daily queue building and module statistics"
```

---

### Task 5: Schemas, Migrationen, Server-Datenbank und Repository

**Files:**
- Create: `packages/core/src/schemas.ts`, `packages/core/src/migrations.ts`
- Modify: `packages/core/src/index.ts`
- Create: `apps/server/package.json`, `apps/server/src/db.ts`, `apps/server/src/repo.ts`
- Test: `apps/server/test/repo.test.ts`, `apps/server/test/helpers.ts`

**Interfaces:**
- Consumes: Typen, `newId`, `clozeOrdinals`, `emptyState`, `QueueCard`.
- Produces:
  - core: `GeneratedNoteSchema`, `ChunkOutputSchema`, `SynthesisOutputSchema`, Typen `GeneratedNote`, `ChunkOutput`, `SynthesisOutput`; `CORE_MIGRATIONS: string[]`
  - server `db.ts`: `type Db = DatabaseSync`, `openDb(file: string): Db`, `migrate(db: Db, migrations: string[]): void`, `tx<T>(db: Db, fn: () => T): T`
  - server `repo.ts`: `nextSeq`, `createModule`, `updateModule`, `deleteModule`, `listModules`, `getModule`, `createDeck`, `updateDeck`, `deleteDeck`, `listDecks`, `getDeck`, `findDeckBySha`, `replaceSlides`, `listSlides`, `insertNote`, `updateNote`, `deleteNote`, `getNote`, `listNotes`, `countNotes`, `unreviewedNoteIds`, `getCard`, `listCardsOfNote`, `setCardSuspended`, `insertRevlog`, `getRevlog`, `listRevlogForCard`, `saveCardState`, `studyRows`, `allReviewTimes` (Signaturen im Code unten).
  - test helper: `memDb(): Db`

- [ ] **Step 1: Schemas und Migration in core**

`packages/core/src/schemas.ts`:
```ts
import { z } from 'zod';

export const GeneratedNoteSchema = z.object({
  kind: z.enum(['qa', 'cloze', 'diagram']),
  front: z.string().min(1),
  back: z.string(),
  slides: z.array(z.number().int()).min(1),
  frontImagePage: z.number().int().nullable(),
  tags: z.array(z.string()),
});

export const ChunkOutputSchema = z.object({
  notes: z.array(GeneratedNoteSchema),
});

export const SynthesisOutputSchema = z.object({
  notes: z.array(GeneratedNoteSchema),
  removeNoteIds: z.array(z.string()),
});

export type GeneratedNote = z.infer<typeof GeneratedNoteSchema>;
export type ChunkOutput = z.infer<typeof ChunkOutputSchema>;
export type SynthesisOutput = z.infer<typeof SynthesisOutputSchema>;
```

`packages/core/src/migrations.ts`:
```ts
/**
 * Gemeinsame SQL-Migrationen für Server und Handy. Index i hebt `PRAGMA user_version` von i auf i+1.
 * `seq` wird nur auf dem Server gepflegt, `dirty` nur auf dem Handy. Die Tabelle `job` nutzt nur der Server.
 */
export const CORE_MIGRATIONS: string[] = [
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT INTO meta (key, value) VALUES ('seq', '0');

  CREATE TABLE module (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, language TEXT NOT NULL, exam_date TEXT,
    new_per_day INTEGER NOT NULL DEFAULT 20, deleted INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL, seq INTEGER NOT NULL DEFAULT 0, dirty INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE deck (
    id TEXT PRIMARY KEY, module_id TEXT NOT NULL REFERENCES module(id), title TEXT NOT NULL,
    pdf_sha256 TEXT NOT NULL, page_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL,
    error TEXT, position INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL, seq INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE slide (
    deck_id TEXT NOT NULL REFERENCES deck(id), page INTEGER NOT NULL, text TEXT NOT NULL,
    image TEXT NOT NULL, seq INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (deck_id, page)
  );
  CREATE TABLE note (
    id TEXT PRIMARY KEY, deck_id TEXT NOT NULL REFERENCES deck(id), kind TEXT NOT NULL,
    front TEXT NOT NULL, back TEXT NOT NULL, slide_refs TEXT NOT NULL, front_image_page INTEGER,
    tags TEXT NOT NULL, source TEXT NOT NULL, position INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
    seq INTEGER NOT NULL DEFAULT 0, dirty INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE card (
    id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES note(id), ordinal INTEGER NOT NULL,
    suspended INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL, seq INTEGER NOT NULL DEFAULT 0, dirty INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE revlog (
    id TEXT PRIMARY KEY, card_id TEXT NOT NULL, rating INTEGER NOT NULL, reviewed_at INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL, device_id TEXT NOT NULL, revokes TEXT,
    seq INTEGER NOT NULL DEFAULT 0, dirty INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE card_state (card_id TEXT PRIMARY KEY, json TEXT NOT NULL, first_reviewed_at INTEGER);
  CREATE TABLE job (
    id TEXT PRIMARY KEY, deck_id TEXT NOT NULL, kind TEXT NOT NULL, chunk_from INTEGER, chunk_to INTEGER,
    status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, error TEXT, created_at INTEGER NOT NULL
  );

  CREATE INDEX deck_module ON deck(module_id);
  CREATE INDEX note_deck ON note(deck_id);
  CREATE INDEX card_note ON card(note_id);
  CREATE INDEX revlog_card ON revlog(card_id);
  CREATE INDEX job_deck ON job(deck_id);
  CREATE INDEX module_seq ON module(seq);
  CREATE INDEX deck_seq ON deck(seq);
  CREATE INDEX slide_seq ON slide(seq);
  CREATE INDEX note_seq ON note(seq);
  CREATE INDEX card_seq ON card(seq);
  CREATE INDEX revlog_seq ON revlog(seq);
  `,
];
```

`packages/core/src/index.ts` ergänzen:
```ts
export * from './schemas.ts';
export * from './migrations.ts';
```

- [ ] **Step 2: Server-Paket anlegen**

`apps/server/package.json`:
```json
{
  "name": "@kartei/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "TZ=Asia/Seoul vitest run",
    "dev": "KARTEI_DATA_DIR=../../.devdata node --watch src/main.ts",
    "start": "node src/main.ts"
  },
  "dependencies": {
    "@kartei/core": "*"
  }
}
```

Run: `nix develop -c npm install -w @kartei/server fastify@^5.12.5 @fastify/multipart@^10.1.2 @fastify/static@^10.1.5 zod@^4.6.5`
Außerdem `.devdata/` in `.gitignore` aufnehmen.

- [ ] **Step 3: Failing Repo-Tests**

`apps/server/test/helpers.ts`:
```ts
import { CORE_MIGRATIONS } from '@kartei/core';
import { DatabaseSync } from 'node:sqlite';
import { migrate, type Db } from '../src/db.ts';

export function memDb(): Db {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db, CORE_MIGRATIONS);
  return db;
}
```

`apps/server/test/repo.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import * as repo from '../src/repo.ts';
import { memDb } from './helpers.ts';

function setup() {
  const db = memDb();
  const mod = repo.createModule(db, { name: 'UI/UX', language: 'en' }, 1000);
  const deck = repo.createDeck(db, { moduleId: mod.id, title: 'Ch1', pdfSha256: 'abc' }, 1000);
  return { db, mod, deck };
}

describe('repo', () => {
  it('legt Module mit Standardwerten an und vergibt steigende seq', () => {
    const { db, mod } = setup();
    expect(mod).toMatchObject({ name: 'UI/UX', language: 'en', examDate: null, newPerDay: 20, deleted: false });
    const s1 = repo.nextSeq(db);
    const s2 = repo.nextSeq(db);
    expect(s2).toBe(s1 + 1);
  });

  it('aktualisiert Module und blendet gelöschte aus', () => {
    const { db, mod } = setup();
    expect(repo.updateModule(db, mod.id, { examDate: '2026-10-30', newPerDay: 30 }, 2000)).toMatchObject({
      examDate: '2026-10-30', newPerDay: 30, updatedAt: 2000,
    });
    repo.deleteModule(db, mod.id, 3000);
    expect(repo.listModules(db)).toHaveLength(0);
  });

  it('vergibt Deck-Positionen fortlaufend und findet PDFs per Hash', () => {
    const { db, mod, deck } = setup();
    const d2 = repo.createDeck(db, { moduleId: mod.id, title: 'Ch2', pdfSha256: 'def' }, 1000);
    expect(d2.position).toBe(deck.position + 1);
    expect(repo.findDeckBySha(db, mod.id, 'def')?.id).toBe(d2.id);
    expect(repo.findDeckBySha(db, mod.id, 'zzz')).toBeUndefined();
  });

  it('legt für Lückentext eine Karte pro Lücke an und gleicht beim Bearbeiten ab', () => {
    const { db, deck } = setup();
    const { note, cards } = repo.insertNote(db, {
      deckId: deck.id, kind: 'cloze', front: '{{c1::A}} und {{c2::B}}', back: '', slideRefs: [1],
      frontImagePage: null, tags: [], source: 'chunk', position: 0,
    }, 1000);
    expect(cards.map((c) => c.ordinal)).toEqual([1, 2]);

    const upd = repo.updateNote(db, note.id, { front: '{{c1::A}} und {{c3::C}}' }, 2000);
    const live = upd.cards.filter((c) => !c.deleted).map((c) => c.ordinal);
    expect(live).toEqual([1, 3]);
    expect(upd.cards.find((c) => c.ordinal === 2)?.deleted).toBe(true);

    const back = repo.updateNote(db, note.id, { front: '{{c1::A}} {{c2::B}} {{c3::C}}' }, 3000);
    expect(back.cards.filter((c) => !c.deleted).map((c) => c.ordinal)).toEqual([1, 2, 3]);
  });

  it('lehnt Lückentext ohne Lücke ab', () => {
    const { db, deck } = setup();
    expect(() => repo.insertNote(db, {
      deckId: deck.id, kind: 'cloze', front: 'keine Lücke', back: '', slideRefs: [1],
      frontImagePage: null, tags: [], source: 'chunk', position: 0,
    }, 1000)).toThrow(/Lücke/);
  });

  it('listNotes filtert nach Text und liefert Deck-Titel und Karten', () => {
    const { db, deck, mod } = setup();
    const base = { deckId: deck.id, back: 'x', slideRefs: [1], frontImagePage: null, tags: [], source: 'chunk' as const };
    repo.insertNote(db, { ...base, kind: 'qa', front: 'What is HCI?', position: 0 }, 1000);
    repo.insertNote(db, { ...base, kind: 'qa', front: 'Define affordance', position: 1 }, 1000);
    const res = repo.listNotes(db, { moduleId: mod.id, q: 'afford' });
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ front: 'Define affordance', deckTitle: 'Ch1' });
    expect(res[0]!.cards).toHaveLength(1);
  });

  it('studyRows liefert nur aktive Karten mit Zustand', () => {
    const { db, deck, mod } = setup();
    const { cards } = repo.insertNote(db, {
      deckId: deck.id, kind: 'qa', front: 'Q', back: 'A', slideRefs: [1], frontImagePage: null,
      tags: [], source: 'chunk', position: 5,
    }, 1000);
    const rows = repo.studyRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ cardId: cards[0]!.id, moduleId: mod.id, sortKey: [deck.position, 5, 0], firstReviewedAt: null });
    expect(rows[0]!.state.state).toBe(0);
    repo.deleteDeck(db, deck.id, 2000);
    expect(repo.studyRows(db)).toHaveLength(0);
  });

  it('insertRevlog ist idempotent', () => {
    const { db } = setup();
    const e = { id: 'r1', cardId: 'c1', rating: 3 as const, reviewedAt: 1, durationMs: 5, deviceId: 'd', revokes: null };
    repo.insertRevlog(db, e);
    repo.insertRevlog(db, e);
    expect(repo.listRevlogForCard(db, 'c1')).toHaveLength(1);
  });
});
```

Run: `nix develop -c npm test -w @kartei/server`
Expected: FAIL – `../src/db.ts` fehlt.

- [ ] **Step 4: db.ts und repo.ts implementieren**

`apps/server/src/db.ts`:
```ts
import { CORE_MIGRATIONS } from '@kartei/core';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

export function openDb(file: string): Db {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db, CORE_MIGRATIONS);
  return db;
}

export function migrate(db: Db, migrations: string[]): void {
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = user_version; v < migrations.length; v++) {
    tx(db, () => {
      db.exec(migrations[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

export function tx<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
```

`apps/server/src/repo.ts`:
```ts
import {
  clozeOrdinals, emptyState, newId,
  type Card, type CardState, type Deck, type DeckStatus, type Language, type Module, type Note,
  type NoteKind, type NoteSource, type QueueCard, type RevlogEntry, type Slide,
} from '@kartei/core';
import { tx, type Db } from './db.ts';

// node:sqlite liefert Zeilen als untypisierte Objekte.
type Row = Record<string, any>;

export function nextSeq(db: Db): number {
  const r = db.prepare("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'seq' RETURNING value").get() as Row;
  return Number(r.value);
}

// ---------- Module ----------

const toModule = (r: Row): Module => ({
  id: r.id, name: r.name, language: r.language, examDate: r.exam_date ?? null,
  newPerDay: r.new_per_day, deleted: !!r.deleted, updatedAt: r.updated_at,
});

export function getModule(db: Db, id: string): Module | undefined {
  const r = db.prepare('SELECT * FROM module WHERE id = ? AND deleted = 0').get(id) as Row | undefined;
  return r && toModule(r);
}

export function listModules(db: Db): Module[] {
  return (db.prepare('SELECT * FROM module WHERE deleted = 0 ORDER BY name').all() as Row[]).map(toModule);
}

export function createModule(
  db: Db,
  input: { name: string; language: Language; examDate?: string | null; newPerDay?: number },
  now = Date.now(),
): Module {
  const id = newId();
  db.prepare(
    'INSERT INTO module (id, name, language, exam_date, new_per_day, updated_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, input.name, input.language, input.examDate ?? null, input.newPerDay ?? 20, now, nextSeq(db));
  return getModule(db, id)!;
}

export function updateModule(
  db: Db,
  id: string,
  patch: Partial<Pick<Module, 'name' | 'language' | 'examDate' | 'newPerDay'>>,
  now = Date.now(),
): Module {
  const cur = getModule(db, id);
  if (!cur) throw new Error(`Modul ${id} nicht gefunden`);
  const next = { ...cur, ...patch };
  db.prepare(
    'UPDATE module SET name = ?, language = ?, exam_date = ?, new_per_day = ?, updated_at = ?, seq = ? WHERE id = ?',
  ).run(next.name, next.language, next.examDate, next.newPerDay, now, nextSeq(db), id);
  return getModule(db, id)!;
}

export function deleteModule(db: Db, id: string, now = Date.now()): void {
  db.prepare('UPDATE module SET deleted = 1, updated_at = ?, seq = ? WHERE id = ?').run(now, nextSeq(db), id);
}

// ---------- Decks ----------

const toDeck = (r: Row): Deck => ({
  id: r.id, moduleId: r.module_id, title: r.title, pdfSha256: r.pdf_sha256, pageCount: r.page_count,
  status: r.status, error: r.error ?? null, position: r.position, deleted: !!r.deleted, updatedAt: r.updated_at,
});

export function getDeck(db: Db, id: string): Deck | undefined {
  const r = db.prepare('SELECT * FROM deck WHERE id = ? AND deleted = 0').get(id) as Row | undefined;
  return r && toDeck(r);
}

export function listDecks(db: Db, moduleId: string): Deck[] {
  return (db.prepare('SELECT * FROM deck WHERE module_id = ? AND deleted = 0 ORDER BY position').all(moduleId) as Row[]).map(toDeck);
}

export function findDeckBySha(db: Db, moduleId: string, sha: string): Deck | undefined {
  const r = db.prepare('SELECT * FROM deck WHERE module_id = ? AND pdf_sha256 = ? AND deleted = 0').get(moduleId, sha) as Row | undefined;
  return r && toDeck(r);
}

export function createDeck(db: Db, input: { moduleId: string; title: string; pdfSha256: string }, now = Date.now()): Deck {
  const id = newId();
  const { pos } = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM deck WHERE module_id = ?').get(input.moduleId) as Row;
  db.prepare(
    "INSERT INTO deck (id, module_id, title, pdf_sha256, status, position, updated_at, seq) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)",
  ).run(id, input.moduleId, input.title, input.pdfSha256, pos, now, nextSeq(db));
  return getDeck(db, id)!;
}

export function updateDeck(
  db: Db,
  id: string,
  patch: Partial<{ title: string; status: DeckStatus; error: string | null; pageCount: number }>,
  now = Date.now(),
): Deck {
  const cur = getDeck(db, id);
  if (!cur) throw new Error(`Foliensatz ${id} nicht gefunden`);
  const next = { ...cur, ...patch };
  db.prepare(
    'UPDATE deck SET title = ?, status = ?, error = ?, page_count = ?, updated_at = ?, seq = ? WHERE id = ?',
  ).run(next.title, next.status, next.error, next.pageCount, now, nextSeq(db), id);
  return getDeck(db, id)!;
}

export function deleteDeck(db: Db, id: string, now = Date.now()): void {
  db.prepare('UPDATE deck SET deleted = 1, updated_at = ?, seq = ? WHERE id = ?').run(now, nextSeq(db), id);
}

// ---------- Folien ----------

export function replaceSlides(db: Db, deckId: string, slides: Slide[]): void {
  tx(db, () => {
    db.prepare('DELETE FROM slide WHERE deck_id = ?').run(deckId);
    const ins = db.prepare('INSERT INTO slide (deck_id, page, text, image, seq) VALUES (?, ?, ?, ?, ?)');
    for (const s of slides) ins.run(deckId, s.page, s.text, s.image, nextSeq(db));
  });
}

export function listSlides(db: Db, deckId: string): Slide[] {
  return (db.prepare('SELECT * FROM slide WHERE deck_id = ? ORDER BY page').all(deckId) as Row[]).map((r) => ({
    deckId: r.deck_id, page: r.page, text: r.text, image: r.image,
  }));
}

// ---------- Notes und Karten ----------

export interface NewNote {
  deckId: string;
  kind: NoteKind;
  front: string;
  back: string;
  slideRefs: number[];
  frontImagePage: number | null;
  tags: string[];
  source: NoteSource;
  position: number;
}

const toNote = (r: Row): Note => ({
  id: r.id, deckId: r.deck_id, kind: r.kind, front: r.front, back: r.back,
  slideRefs: JSON.parse(r.slide_refs), frontImagePage: r.front_image_page ?? null, tags: JSON.parse(r.tags),
  source: r.source, position: r.position, deleted: !!r.deleted, updatedAt: r.updated_at,
});

const toCard = (r: Row): Card => ({
  id: r.id, noteId: r.note_id, ordinal: r.ordinal, suspended: !!r.suspended, deleted: !!r.deleted, updatedAt: r.updated_at,
});

function ordinalsFor(kind: NoteKind, front: string): number[] {
  if (kind !== 'cloze') return [0];
  const ords = clozeOrdinals(front);
  if (ords.length === 0) throw new Error('Lückentext ohne Lücke ({{c1::…}})');
  return ords;
}

export function getNote(db: Db, id: string): Note | undefined {
  const r = db.prepare('SELECT * FROM note WHERE id = ?').get(id) as Row | undefined;
  return r && toNote(r);
}

export function listCardsOfNote(db: Db, noteId: string): Card[] {
  return (db.prepare('SELECT * FROM card WHERE note_id = ? ORDER BY ordinal').all(noteId) as Row[]).map(toCard);
}

export function getCard(db: Db, id: string): Card | undefined {
  const r = db.prepare('SELECT * FROM card WHERE id = ?').get(id) as Row | undefined;
  return r && toCard(r);
}

export function insertNote(db: Db, input: NewNote, now = Date.now()): { note: Note; cards: Card[] } {
  const ords = ordinalsFor(input.kind, input.front);
  return tx(db, () => {
    const id = newId();
    db.prepare(
      `INSERT INTO note (id, deck_id, kind, front, back, slide_refs, front_image_page, tags, source, position, updated_at, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.deckId, input.kind, input.front, input.back, JSON.stringify(input.slideRefs),
      input.frontImagePage, JSON.stringify(input.tags), input.source, input.position, now, nextSeq(db));
    const ins = db.prepare('INSERT INTO card (id, note_id, ordinal, updated_at, seq) VALUES (?, ?, ?, ?, ?)');
    for (const o of ords) ins.run(newId(), id, o, now, nextSeq(db));
    return { note: getNote(db, id)!, cards: listCardsOfNote(db, id) };
  });
}

export function updateNote(
  db: Db,
  id: string,
  patch: { front?: string; back?: string; tags?: string[] },
  now = Date.now(),
): { note: Note; cards: Card[] } {
  const cur = getNote(db, id);
  if (!cur) throw new Error(`Note ${id} nicht gefunden`);
  const next = { ...cur, ...patch };
  const ords = ordinalsFor(next.kind, next.front);
  return tx(db, () => {
    db.prepare('UPDATE note SET front = ?, back = ?, tags = ?, updated_at = ?, seq = ? WHERE id = ?')
      .run(next.front, next.back, JSON.stringify(next.tags), now, nextSeq(db), id);
    const existing = listCardsOfNote(db, id);
    for (const c of existing) {
      const shouldLive = ords.includes(c.ordinal);
      if (shouldLive === c.deleted) {
        db.prepare('UPDATE card SET deleted = ?, updated_at = ?, seq = ? WHERE id = ?').run(shouldLive ? 0 : 1, now, nextSeq(db), c.id);
      }
    }
    for (const o of ords) {
      if (!existing.some((c) => c.ordinal === o)) {
        db.prepare('INSERT INTO card (id, note_id, ordinal, updated_at, seq) VALUES (?, ?, ?, ?, ?)').run(newId(), id, o, now, nextSeq(db));
      }
    }
    return { note: getNote(db, id)!, cards: listCardsOfNote(db, id) };
  });
}

export function deleteNote(db: Db, id: string, now = Date.now()): void {
  tx(db, () => {
    db.prepare('UPDATE note SET deleted = 1, updated_at = ?, seq = ? WHERE id = ?').run(now, nextSeq(db), id);
    for (const c of listCardsOfNote(db, id)) {
      db.prepare('UPDATE card SET deleted = 1, updated_at = ?, seq = ? WHERE id = ?').run(now, nextSeq(db), c.id);
    }
  });
}

export function setCardSuspended(db: Db, cardId: string, suspended: boolean, now = Date.now()): void {
  db.prepare('UPDATE card SET suspended = ?, updated_at = ?, seq = ? WHERE id = ?').run(suspended ? 1 : 0, now, nextSeq(db), cardId);
}

export interface NoteListItem extends Note {
  deckTitle: string;
  cards: Card[];
}

export function listNotes(
  db: Db,
  filter: { deckId?: string; moduleId?: string; q?: string; kind?: NoteKind; limit?: number },
): NoteListItem[] {
  const where = ['n.deleted = 0', 'd.deleted = 0'];
  const params: (string | number)[] = [];
  if (filter.deckId) { where.push('n.deck_id = ?'); params.push(filter.deckId); }
  if (filter.moduleId) { where.push('d.module_id = ?'); params.push(filter.moduleId); }
  if (filter.kind) { where.push('n.kind = ?'); params.push(filter.kind); }
  if (filter.q) { where.push('(n.front LIKE ? OR n.back LIKE ?)'); params.push(`%${filter.q}%`, `%${filter.q}%`); }
  params.push(filter.limit ?? 500);
  const rows = db.prepare(
    `SELECT n.*, d.title AS deck_title FROM note n JOIN deck d ON d.id = n.deck_id
     WHERE ${where.join(' AND ')} ORDER BY d.position, n.position LIMIT ?`,
  ).all(...params) as Row[];
  return rows.map((r) => ({ ...toNote(r), deckTitle: r.deck_title, cards: listCardsOfNote(db, r.id).filter((c) => !c.deleted) }));
}

export function countNotes(db: Db, deckId: string): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM note WHERE deck_id = ? AND deleted = 0').get(deckId) as Row).n;
}

/** Notes eines Decks, von deren Karten noch keine bewertet wurde. */
export function unreviewedNoteIds(db: Db, deckId: string): string[] {
  return (db.prepare(
    `SELECT n.id FROM note n WHERE n.deck_id = ? AND n.deleted = 0 AND NOT EXISTS (
       SELECT 1 FROM card c JOIN revlog r ON r.card_id = c.id WHERE c.note_id = n.id)`,
  ).all(deckId) as Row[]).map((r) => r.id);
}

// ---------- Bewertungen und Zustand ----------

const toRevlog = (r: Row): RevlogEntry => ({
  id: r.id, cardId: r.card_id, rating: r.rating, reviewedAt: r.reviewed_at, durationMs: r.duration_ms,
  deviceId: r.device_id, revokes: r.revokes ?? null,
});

export function insertRevlog(db: Db, e: RevlogEntry): void {
  const exists = db.prepare('SELECT 1 FROM revlog WHERE id = ?').get(e.id);
  if (exists) return;
  db.prepare(
    'INSERT INTO revlog (id, card_id, rating, reviewed_at, duration_ms, device_id, revokes, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(e.id, e.cardId, e.rating, e.reviewedAt, e.durationMs, e.deviceId, e.revokes, nextSeq(db));
}

export function getRevlog(db: Db, id: string): RevlogEntry | undefined {
  const r = db.prepare('SELECT * FROM revlog WHERE id = ?').get(id) as Row | undefined;
  return r && toRevlog(r);
}

export function listRevlogForCard(db: Db, cardId: string): RevlogEntry[] {
  return (db.prepare('SELECT * FROM revlog WHERE card_id = ?').all(cardId) as Row[]).map(toRevlog);
}

export function saveCardState(db: Db, cardId: string, state: CardState, firstReviewedAt: number | null): void {
  db.prepare(
    `INSERT INTO card_state (card_id, json, first_reviewed_at) VALUES (?, ?, ?)
     ON CONFLICT(card_id) DO UPDATE SET json = excluded.json, first_reviewed_at = excluded.first_reviewed_at`,
  ).run(cardId, JSON.stringify(state), firstReviewedAt);
}

/** Alle lernbaren Karten (nicht gelöscht, Note/Deck/Modul nicht gelöscht). */
export function studyRows(db: Db): QueueCard[] {
  const rows = db.prepare(
    `SELECT c.id AS card_id, c.ordinal, c.suspended, n.id AS note_id, n.position AS note_pos,
            d.id AS deck_id, d.position AS deck_pos, d.module_id, s.json, s.first_reviewed_at
     FROM card c
     JOIN note n ON n.id = c.note_id
     JOIN deck d ON d.id = n.deck_id
     JOIN module m ON m.id = d.module_id
     LEFT JOIN card_state s ON s.card_id = c.id
     WHERE c.deleted = 0 AND n.deleted = 0 AND d.deleted = 0 AND m.deleted = 0`,
  ).all() as Row[];
  return rows.map((r) => ({
    cardId: r.card_id,
    noteId: r.note_id,
    deckId: r.deck_id,
    moduleId: r.module_id,
    sortKey: [r.deck_pos, r.note_pos, r.ordinal] as [number, number, number],
    state: r.json ? (JSON.parse(r.json) as CardState) : emptyState(),
    firstReviewedAt: r.first_reviewed_at ?? null,
    suspended: !!r.suspended,
  }));
}

/** Zeitpunkte aller gültigen Bewertungen (für Serie/heute gelernt). */
export function allReviewTimes(db: Db): number[] {
  return (db.prepare(
    `SELECT reviewed_at FROM revlog r WHERE rating >= 1
     AND NOT EXISTS (SELECT 1 FROM revlog u WHERE u.revokes = r.id)`,
  ).all() as Row[]).map((r) => r.reviewed_at);
}
```

- [ ] **Step 5: Tests laufen lassen**

Run: `nix develop -c npm test -w @kartei/server`
Expected: PASS (8 Tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(server): sqlite schema, migrations and repository"
```

---

### Task 6: PDF-Aufbereitung

**Files:**
- Create: `apps/server/src/pdf.ts`
- Create: `apps/server/test/makePdf.ts`
- Test: `apps/server/test/pdf.test.ts`

**Interfaces:**
- Produces: `interface RenderedSlide { page: number; text: string; image: string }`, `renderPdf(pdfPath: string, outDir: string): Promise<RenderedSlide[]>`, `normalizeText(s: string): string`, `pageFromImageName(file: string): number | null`; Test-Helper `makePdf(pages: string[]): Buffer`.

- [ ] **Step 1: Test-Helper und Failing Tests**

`apps/server/test/makePdf.ts`:
```ts
/** Erzeugt eine minimale gültige PDF mit einer Textzeile pro Seite. */
export function makePdf(pages: string[]): Buffer {
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pages.forEach((text, i) => {
    const stream = `BT /F1 24 Tf 72 700 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    );
    objs.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
```

`apps/server/test/pdf.test.ts`:
```ts
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeText, pageFromImageName, renderPdf } from '../src/pdf.ts';
import { makePdf } from './makePdf.ts';

async function tmp() {
  return mkdtemp(path.join(tmpdir(), 'kartei-pdf-'));
}

describe('renderPdf', () => {
  it('rendert jede Seite als JPEG und liest den Text', async () => {
    const dir = await tmp();
    const pdf = path.join(dir, 'a.pdf');
    await writeFile(pdf, makePdf(['Slide One', 'Slide Two', 'Slide Three']));
    const slides = await renderPdf(pdf, path.join(dir, 'out'));
    expect(slides.map((s) => s.page)).toEqual([1, 2, 3]);
    expect(slides[1]!.text).toContain('Slide Two');
    for (const s of slides) expect(existsSync(path.join(dir, 'out', s.image))).toBe(true);
    expect(slides[0]!.image).toBe('1.jpg');
  });

  it('normalisiert zweistellige Dateinamen (p-01.jpg)', async () => {
    const dir = await tmp();
    const pdf = path.join(dir, 'b.pdf');
    await writeFile(pdf, makePdf(Array.from({ length: 12 }, (_, i) => `Page ${i + 1}`)));
    const slides = await renderPdf(pdf, path.join(dir, 'out'));
    expect(slides).toHaveLength(12);
    expect(existsSync(path.join(dir, 'out', '12.jpg'))).toBe(true);
    expect(existsSync(path.join(dir, 'out', '1.jpg'))).toBe(true);
  });

  it('lehnt eine Nicht-PDF ab', async () => {
    const dir = await tmp();
    const bad = path.join(dir, 'x.pdf');
    await writeFile(bad, 'kein pdf');
    await expect(renderPdf(bad, path.join(dir, 'out'))).rejects.toThrow();
  });
});

describe('Hilfsfunktionen', () => {
  it('pageFromImageName', () => {
    expect(pageFromImageName('p-1.jpg')).toBe(1);
    expect(pageFromImageName('p-07.jpg')).toBe(7);
    expect(pageFromImageName('p-120.jpg')).toBe(120);
    expect(pageFromImageName('x.jpg')).toBeNull();
  });
  it('normalizeText entfernt Seitenumbrüche und Leerzeilen-Ketten', () => {
    expect(normalizeText('A   \n\n\n\nB    C\f')).toBe('A\n\nB  C');
  });
});
```

Run: `nix develop -c npm test -w @kartei/server -- pdf`
Expected: FAIL – `../src/pdf.ts` fehlt.

- [ ] **Step 2: Implementierung**

`apps/server/src/pdf.ts`:
```ts
import { execFile } from 'node:child_process';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface RenderedSlide {
  page: number;
  text: string;
  image: string;
}

export function normalizeText(s: string): string {
  return s
    .replace(/\f/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]{2,}/g, '  ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** pdftoppm benennt je nach Seitenzahl p-1.jpg, p-01.jpg oder p-001.jpg. */
export function pageFromImageName(file: string): number | null {
  const m = /^p-0*(\d+)\.jpg$/.exec(file);
  return m ? Number(m[1]) : null;
}

export async function renderPdf(pdfPath: string, outDir: string): Promise<RenderedSlide[]> {
  const info = await run('pdfinfo', [pdfPath]);
  const m = /^Pages:\s+(\d+)/m.exec(info.stdout);
  if (!m) throw new Error('pdfinfo: Seitenzahl nicht gefunden');
  const pages = Number(m[1]);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await run('pdftoppm', ['-jpeg', '-jpegopt', 'quality=80', '-scale-to', '1280', pdfPath, path.join(outDir, 'p')], {
    maxBuffer: 1 << 26,
  });
  for (const f of await readdir(outDir)) {
    const page = pageFromImageName(f);
    if (page !== null) await rename(path.join(outDir, f), path.join(outDir, `${page}.jpg`));
  }

  const slides: RenderedSlide[] = [];
  for (let p = 1; p <= pages; p++) {
    const t = await run('pdftotext', ['-layout', '-f', String(p), '-l', String(p), pdfPath, '-'], { maxBuffer: 1 << 24 });
    slides.push({ page: p, text: normalizeText(t.stdout), image: `${p}.jpg` });
  }
  return slides;
}
```

- [ ] **Step 3: Tests laufen lassen**

Run: `nix develop -c npm test -w @kartei/server -- pdf`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(server): render pdf slides to jpeg and extract text"
```

---

### Task 7: Claude-Runner und Prompts

**Files:**
- Create: `apps/server/src/claude.ts`, `apps/server/src/prompt.ts`
- Create: `apps/server/test/fixtures/fake-claude.mjs`
- Test: `apps/server/test/claude.test.ts`, `apps/server/test/prompt.test.ts`

**Interfaces:**
- Consumes: `ChunkOutputSchema`, `SynthesisOutputSchema`, `Language`.
- Produces:
  - `type ClaudeFailure = 'auth' | 'rate_limit' | 'invalid' | 'failed'`
  - `type ClaudeResult = { ok: true; output: unknown } | { ok: false; kind: ClaudeFailure; message: string }`
  - `interface ClaudeRequest { prompt: string; jsonSchema: object; addDirs: string[]; cwd: string; timeoutMs?: number }`
  - `type RunClaude = (req: ClaudeRequest) => Promise<ClaudeResult>`
  - `classifyError(text: string): ClaudeFailure`, `parseClaudeOutput(stdout: string): ClaudeResult`, `createClaudeRunner(opts: { claudePath: string; model: string | null }): RunClaude`
  - `chunkJsonSchema: object`, `synthesisJsonSchema: object`, `outlineOf(slides: { page: number; text: string }[]): string`, `buildChunkPrompt(i: ChunkPromptInput): string`, `buildSynthesisPrompt(i: SynthesisPromptInput): string`

- [ ] **Step 1: Fake-claude und Failing Tests**

`apps/server/test/fixtures/fake-claude.mjs`:
```js
#!/usr/bin/env node
// Ersetzt `claude` in Tests. Verhalten über FAKE_CLAUDE_MODE, Protokoll nach FAKE_CLAUDE_LOG.
import { appendFileSync } from 'node:fs';

let stdin = '';
process.stdin.on('data', (d) => (stdin += d));
process.stdin.on('end', () => {
  if (process.env.FAKE_CLAUDE_LOG) {
    appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ argv: process.argv.slice(2), stdin }) + '\n');
  }
  const mode = process.env.FAKE_CLAUDE_MODE ?? 'ok';
  const env = (o) => process.stdout.write(JSON.stringify({ type: 'result', ...o }));
  if (mode === 'ok') {
    env({ subtype: 'success', is_error: false, result: '', structured_output: { notes: [{ kind: 'qa', front: 'Q', back: 'A', slides: [1], frontImagePage: null, tags: [] }] } });
  } else if (mode === 'fenced') {
    env({ subtype: 'success', is_error: false, result: 'Hier:\n```json\n{"notes":[]}\n```' });
  } else if (mode === 'invalid') {
    env({ subtype: 'success', is_error: false, result: 'Entschuldigung, das kann ich nicht.' });
  } else if (mode === 'auth') {
    env({ subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' });
    process.exitCode = 1;
  } else if (mode === 'ratelimit') {
    env({ subtype: 'success', is_error: true, result: "You've hit your usage limit · resets 5pm", api_error_status: 429 });
    process.exitCode = 1;
  } else if (mode === 'crash') {
    process.stderr.write('Segmentation fault');
    process.exitCode = 139;
  }
});
```

`apps/server/test/claude.test.ts`:
```ts
import { chmodSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { classifyError, createClaudeRunner, parseClaudeOutput } from '../src/claude.ts';

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));

beforeAll(() => chmodSync(FAKE, 0o755));
afterEach(() => {
  delete process.env.FAKE_CLAUDE_MODE;
  delete process.env.FAKE_CLAUDE_LOG;
});

async function call(mode: string) {
  const dir = await mkdtemp(path.join(tmpdir(), 'kartei-claude-'));
  process.env.FAKE_CLAUDE_MODE = mode;
  process.env.FAKE_CLAUDE_LOG = path.join(dir, 'log.jsonl');
  const run = createClaudeRunner({ claudePath: FAKE, model: 'sonnet' });
  const res = await run({ prompt: 'PROMPT-TEXT', jsonSchema: { type: 'object' }, addDirs: ['/slides/x'], cwd: dir });
  const log = JSON.parse(readFileSync(process.env.FAKE_CLAUDE_LOG, 'utf8').trim().split('\n')[0]!);
  return { res, log };
}

describe('createClaudeRunner', () => {
  it('liest structured_output und übergibt Prompt per stdin', async () => {
    const { res, log } = await call('ok');
    expect(res).toEqual({ ok: true, output: { notes: [expect.objectContaining({ front: 'Q' })] } });
    expect(log.stdin).toBe('PROMPT-TEXT');
    expect(log.argv).toEqual(expect.arrayContaining(['-p', '--output-format', 'json', '--json-schema', '--add-dir', '/slides/x', '--model', 'sonnet']));
    expect(log.argv[log.argv.indexOf('--tools') + 1]).toBe('Read');
  });
  it('akzeptiert einen ```json-Block als Fallback', async () => {
    expect((await call('fenced')).res).toEqual({ ok: true, output: { notes: [] } });
  });
  it('meldet ungültiges JSON', async () => {
    expect((await call('invalid')).res).toMatchObject({ ok: false, kind: 'invalid' });
  });
  it('erkennt fehlenden Login', async () => {
    expect((await call('auth')).res).toMatchObject({ ok: false, kind: 'auth' });
  });
  it('erkennt Rate-Limits', async () => {
    expect((await call('ratelimit')).res).toMatchObject({ ok: false, kind: 'rate_limit' });
  });
  it('meldet Abstürze als failed', async () => {
    expect((await call('crash')).res).toMatchObject({ ok: false, kind: 'failed' });
  });
  it('meldet fehlendes Programm', async () => {
    const run = createClaudeRunner({ claudePath: '/nonexistent/claude', model: null });
    expect(await run({ prompt: 'x', jsonSchema: {}, addDirs: [], cwd: tmpdir() })).toMatchObject({ ok: false, kind: 'failed' });
  });
});

describe('classifyError / parseClaudeOutput', () => {
  it('klassifiziert typische Meldungen', () => {
    expect(classifyError('Invalid API key · Please run /login')).toBe('auth');
    expect(classifyError('API Error: 529 overloaded')).toBe('rate_limit');
    expect(classifyError('irgendwas')).toBe('failed');
  });
  it('behandelt leere Ausgabe', () => {
    expect(parseClaudeOutput('')).toMatchObject({ ok: false });
  });
});
```

`apps/server/test/prompt.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildChunkPrompt, buildSynthesisPrompt, chunkJsonSchema, outlineOf, synthesisJsonSchema } from '../src/prompt.ts';

const slides = [
  { page: 3, text: 'Norman\'s Gulfs\nExecution and evaluation', imagePath: '/data/slides/d/3.jpg' },
  { page: 4, text: 'Affordances', imagePath: '/data/slides/d/4.jpg' },
];

describe('prompts', () => {
  it('Gliederung nutzt die erste nichtleere Zeile', () => {
    expect(outlineOf([{ page: 1, text: '\n  Intro  \nmore' }, { page: 2, text: '' }])).toBe('p. 1: Intro\np. 2: (leer)');
  });
  it('Chunk-Prompt enthält Folien, Bildpfade und Sprachregel', () => {
    const p = buildChunkPrompt({ language: 'en', deckTitle: 'Ch3', outline: 'p. 1: Intro', slides });
    expect(p).toContain('=== Slide 3 ===');
    expect(p).toContain('/data/slides/d/4.jpg');
    expect(p).toContain('Write every card in English');
    expect(p).toContain('p. 1: Intro');
  });
  it('deutsche Module verlangen deutsche Karten mit englischen Fachbegriffen', () => {
    const p = buildChunkPrompt({ language: 'de', deckTitle: 'X', outline: '', slides });
    expect(p).toContain('German');
  });
  it('Synthese-Prompt listet bestehende Karten mit IDs', () => {
    const p = buildSynthesisPrompt({ language: 'en', deckTitle: 'Ch3', slides, existing: [{ id: 'n-1', front: 'What is a gulf?' }] });
    expect(p).toContain('[n-1] What is a gulf?');
    expect(p).toContain('removeNoteIds');
  });
  it('JSON-Schemas beschreiben notes', () => {
    expect(JSON.stringify(chunkJsonSchema)).toContain('"notes"');
    expect(JSON.stringify(synthesisJsonSchema)).toContain('"removeNoteIds"');
  });
});
```

Run: `nix develop -c npm test -w @kartei/server -- claude prompt`
Expected: FAIL – Module fehlen.

- [ ] **Step 2: Implementierung**

`apps/server/src/claude.ts`:
```ts
import { spawn } from 'node:child_process';

export type ClaudeFailure = 'auth' | 'rate_limit' | 'invalid' | 'failed';
export type ClaudeResult = { ok: true; output: unknown } | { ok: false; kind: ClaudeFailure; message: string };

export interface ClaudeRequest {
  prompt: string;
  jsonSchema: object;
  addDirs: string[];
  cwd: string;
  timeoutMs?: number;
}

export type RunClaude = (req: ClaudeRequest) => Promise<ClaudeResult>;

export function classifyError(text: string): ClaudeFailure {
  if (/not logged in|\/login|authenticat|unauthori[sz]ed|\b401\b|invalid api key|oauth/i.test(text)) return 'auth';
  if (/rate.?limit|usage limit|limit reached|\b429\b|overloaded|\b529\b/i.test(text)) return 'rate_limit';
  return 'failed';
}

export function parseClaudeOutput(stdout: string): ClaudeResult {
  let env: any;
  try {
    env = JSON.parse(stdout.trim());
  } catch {
    return { ok: false, kind: stdout.trim() ? classifyError(stdout) : 'failed', message: stdout.slice(0, 500) || 'leere Ausgabe von claude' };
  }
  if (env.is_error || (typeof env.subtype === 'string' && env.subtype !== 'success')) {
    const msg = String(env.result ?? env.subtype ?? 'Fehler');
    return { ok: false, kind: classifyError(`${msg} ${env.api_error_status ?? ''}`), message: msg.slice(0, 500) };
  }
  if (env.structured_output !== undefined && env.structured_output !== null) return { ok: true, output: env.structured_output };
  const text = String(env.result ?? '');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  try {
    return { ok: true, output: JSON.parse(fenced ? fenced[1]! : text) };
  } catch {
    return { ok: false, kind: 'invalid', message: 'Antwort von claude ist kein JSON' };
  }
}

export function createClaudeRunner(opts: { claudePath: string; model: string | null }): RunClaude {
  return (req) =>
    new Promise((resolve) => {
      const args = [
        '-p', '--output-format', 'json', '--no-session-persistence',
        '--tools', 'Read', '--allowedTools', 'Read',
        '--strict-mcp-config', '--setting-sources', '',
        '--json-schema', JSON.stringify(req.jsonSchema),
      ];
      for (const d of req.addDirs) args.push('--add-dir', d);
      if (opts.model) args.push('--model', opts.model);

      const child = spawn(opts.claudePath, args, { cwd: req.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      let done = false;
      const finish = (r: ClaudeResult) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(r);
      };
      const timer = setTimeout(() => child.kill('SIGTERM'), req.timeoutMs ?? 600_000);
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('error', (e) => finish({ ok: false, kind: 'failed', message: `claude nicht startbar: ${e.message}` }));
      child.on('close', (code, signal) => {
        if (signal) return finish({ ok: false, kind: 'failed', message: `claude abgebrochen (${signal}) – Timeout?` });
        const r = parseClaudeOutput(out);
        if (!r.ok && code !== 0 && err.trim() && r.kind === 'failed') {
          return finish({ ok: false, kind: classifyError(err), message: err.slice(0, 500) });
        }
        finish(r);
      });
      child.stdin.on('error', () => {});
      child.stdin.end(req.prompt);
    });
}
```

`apps/server/src/prompt.ts`:
```ts
import { ChunkOutputSchema, SynthesisOutputSchema, type Language } from '@kartei/core';
import { z } from 'zod';

export const chunkJsonSchema: object = z.toJSONSchema(ChunkOutputSchema);
export const synthesisJsonSchema: object = z.toJSONSchema(SynthesisOutputSchema);

export interface PromptSlide {
  page: number;
  text: string;
  imagePath: string;
}

export interface ChunkPromptInput {
  language: Language;
  deckTitle: string;
  outline: string;
  slides: PromptSlide[];
}

export interface SynthesisPromptInput {
  language: Language;
  deckTitle: string;
  slides: { page: number; text: string }[];
  existing: { id: string; front: string }[];
}

export function outlineOf(slides: { page: number; text: string }[]): string {
  return slides
    .map((s) => {
      const first = s.text.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
      return `p. ${s.page}: ${first ? first.slice(0, 80) : '(leer)'}`;
    })
    .join('\n');
}

function languageRule(language: Language): string {
  return language === 'en'
    ? 'Write every card in English, using the exact technical terms from the slides.'
    : 'Write every card in German. The first time an English technical term from the slides appears on a card, give it in parentheses after the German term, e.g. "Gestaltungsrichtlinien (design guidelines)".';
}

const CARD_RULES = `
Card rules:
- Goal: the student must be able to pass a university exam with multiple-choice, short-answer and essay questions using ONLY these cards. Be thorough: cover every definition, model, principle, list, distinction and example that is examinable.
- Skip title, agenda, organisational and "questions?" slides.
- Roughly 1–3 cards per content slide; more for dense slides, none for empty ones.
- One learning goal per card. Answers are detailed: definition, explanation, a concrete example, and where useful the contrast to related concepts. Use Markdown (bullet lists, **bold** key terms). No answer is a single word unless it is a cloze.
- Card kinds:
  - "qa": question on front, answer on back. Mix definition ("What is …?"), explanation ("Explain …", "Why …?"), comparison ("Difference between X and Y?") and enumeration ("Name the four …") questions.
  - "cloze": for key sentences and lists. Put the full sentence on the front with gaps written as {{c1::text}}, {{c2::text}} …; each number becomes its own card. "back" holds optional extra explanation (may be empty).
  - "diagram": for slides whose figure carries meaning (process models, diagrams, interface examples). The slide image is shown on the front; set "frontImagePage" to that slide's page and ask about the figure ("What does this model show? Explain its phases."). Look at the slide image with the Read tool before writing such a card.
- "slides": page numbers the card is based on (from the "=== Slide N ===" markers). "frontImagePage": page number for diagram cards, otherwise null. "tags": 1–3 short topic tags.
- Never invent content that is not supported by the slides; you may add a brief clarifying example.`;

export function buildChunkPrompt(i: ChunkPromptInput): string {
  const body = i.slides
    .map((s) => `=== Slide ${s.page} ===\nImage: ${s.imagePath}\n${s.text || '(no extractable text – look at the image)'}`)
    .join('\n\n');
  return `You are creating spaced-repetition flashcards from lecture slides.

Lecture: "${i.deckTitle}"
${languageRule(i.language)}

Outline of the whole lecture (for context only):
${i.outline}

${CARD_RULES}

Slides to turn into cards (text extracted from the PDF; image paths can be opened with the Read tool – do so for slides with figures or little text):

${body}

Return JSON matching the given schema: {"notes": [...]}.`;
}

export function buildSynthesisPrompt(i: SynthesisPromptInput): string {
  const text = i.slides.map((s) => `=== Slide ${s.page} ===\n${s.text}`).join('\n\n');
  const existing = i.existing.map((e) => `[${e.id}] ${e.front.replace(/\s+/g, ' ').slice(0, 200)}`).join('\n');
  return `You are reviewing a set of spaced-repetition flashcards generated slide-by-slide from a lecture.

Lecture: "${i.deckTitle}"
${languageRule(i.language)}

Tasks:
1. Add cards that connect concepts across slides and typical exam questions for this lecture (e.g. "Compare …", "How does X relate to Y?", "Apply … to an example", "Summarise the steps of …"). Do not repeat existing cards.
2. Find duplicates among the existing cards. For each group of cards that ask essentially the same thing, keep the best one and list the IDs of the others in "removeNoteIds".

${CARD_RULES}

Full lecture text:

${text}

Existing cards ([id] front):
${existing}

Return JSON matching the given schema: {"notes": [...], "removeNoteIds": [...]}.`;
}
```

- [ ] **Step 3: Tests laufen lassen**

Run: `nix develop -c npm test -w @kartei/server -- claude prompt`
Expected: PASS.

- [ ] **Step 4: Ein echter Rauchtest (manuell, nutzt Lunas Abo, ca. 1 Aufruf)**

Run:
```bash
nix develop -c node -e "
import('./apps/server/src/claude.ts').then(async ({ createClaudeRunner }) => {
  const { chunkJsonSchema } = await import('./apps/server/src/prompt.ts');
  const r = await createClaudeRunner({ claudePath: process.env.HOME + '/.local/bin/claude', model: null })({
    prompt: 'Create one qa flashcard (slides [1], frontImagePage null, tags []) defining HCI.',
    jsonSchema: chunkJsonSchema, addDirs: [], cwd: '/tmp' });
  console.log(JSON.stringify(r).slice(0, 400));
});"
```
Expected: `{"ok":true,"output":{"notes":[{"kind":"qa",…`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): headless claude runner and card generation prompts"
```

---

### Task 8: Erzeugungs-Worker (Job-Queue)

**Files:**
- Create: `apps/server/src/generation.ts`
- Test: `apps/server/test/generation.test.ts`

**Interfaces:**
- Consumes: repo-Funktionen (Task 5), `renderPdf`/`RenderedSlide` (Task 6), `RunClaude`, `ClaudeResult`, `buildChunkPrompt`, `buildSynthesisPrompt`, `outlineOf`, `chunkJsonSchema`, `synthesisJsonSchema` (Task 7), `ChunkOutputSchema`, `SynthesisOutputSchema`, `GeneratedNote`, `clozeOrdinals`.
- Produces:
  - `interface Job { id: string; deckId: string; kind: 'render' | 'chunk' | 'synthesis'; chunkFrom: number | null; chunkTo: number | null; status: 'queued' | 'running' | 'done' | 'failed'; attempts: number; error: string | null; createdAt: number }`
  - `interface WorkerStatus { state: 'idle' | 'running' | 'paused'; pauseReason: string | null; pausedUntil: number | null; current: { jobId: string; deckId: string; kind: Job['kind'] } | null; queued: number }`
  - `interface Worker { tick(): Promise<boolean>; start(): void; stop(): Promise<void>; status(): WorkerStatus; resume(): void; wake(): void }`
  - `CHUNK_SIZE = 15`, `MAX_ATTEMPTS = 3`, `RATE_LIMIT_BACKOFF_MS = [300_000, 900_000, 3_600_000]`
  - `enqueueDeck(db, deckId, now?)`, `regenerateDeck(db, deckId, now?)`, `retryJob(db, jobId)`, `listJobs(db, deckId): Job[]`, `resetRunningJobs(db)`, `sanitizeNote(n: GeneratedNote, pageCount: number, fallbackPage: number): NewNote-Teil | null`
  - `createWorker(deps: { db: Db; dataDir: string; runClaude: RunClaude; render?: (pdf: string, out: string) => Promise<RenderedSlide[]>; now?: () => number; chunkSize?: number }): Worker`

- [ ] **Step 1: Failing Tests**

`apps/server/test/generation.test.ts`:
```ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ClaudeRequest, ClaudeResult } from '../src/claude.ts';
import { createWorker, enqueueDeck, listJobs, regenerateDeck, resetRunningJobs, retryJob, sanitizeNote } from '../src/generation.ts';
import * as repo from '../src/repo.ts';
import { memDb } from './helpers.ts';

const PAGES = 5;

/** Fake-Claude: erzeugt pro Folie im Prompt eine qa-Karte, bei Synthese eine Verknüpfungskarte. */
function fakeClaude(script: Partial<Record<number, ClaudeResult>> = {}) {
  const calls: ClaudeRequest[] = [];
  const run = async (req: ClaudeRequest): Promise<ClaudeResult> => {
    calls.push(req);
    const scripted = script[calls.length];
    if (scripted) return scripted;
    if (req.prompt.includes('removeNoteIds')) {
      const ids = [...req.prompt.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1]!);
      return { ok: true, output: { notes: [{ kind: 'qa', front: 'Compare A and B', back: 'x', slides: [1, 2], frontImagePage: null, tags: [] }], removeNoteIds: ids.slice(0, 1) } };
    }
    const pages = [...req.prompt.matchAll(/=== Slide (\d+) ===/g)].map((m) => Number(m[1]));
    return { ok: true, output: { notes: pages.map((p) => ({ kind: 'qa', front: `Q${p}`, back: `A${p}`, slides: [p], frontImagePage: null, tags: [] })) } };
  };
  return { run, calls };
}

const fakeRender = async () =>
  Array.from({ length: PAGES }, (_, i) => ({ page: i + 1, text: `Text of slide ${i + 1}`, image: `${i + 1}.jpg` }));

async function setup(script: Partial<Record<number, ClaudeResult>> = {}) {
  const db = memDb();
  const dataDir = await mkdtemp(path.join(tmpdir(), 'kartei-gen-'));
  const mod = repo.createModule(db, { name: 'UIUX', language: 'en' });
  const deck = repo.createDeck(db, { moduleId: mod.id, title: 'Ch1', pdfSha256: 'sha' });
  let now = 1_000_000;
  const claude = fakeClaude(script);
  const worker = createWorker({ db, dataDir, runClaude: claude.run, render: fakeRender, now: () => now, chunkSize: 2 });
  const drain = async () => { for (let i = 0; i < 50 && (await worker.tick()); i++); };
  return { db, deck, worker, claude, drain, advance: (ms: number) => (now += ms) };
}

describe('Worker', () => {
  it('rendert, erzeugt pro Abschnitt Karten und führt die Synthese aus', async () => {
    const { db, deck, claude, drain } = await setup();
    enqueueDeck(db, deck.id);
    await drain();
    expect(repo.getDeck(db, deck.id)).toMatchObject({ status: 'ready', pageCount: PAGES, error: null });
    expect(repo.listSlides(db, deck.id)).toHaveLength(PAGES);
    expect(listJobs(db, deck.id).map((j) => j.kind)).toEqual(['render', 'chunk', 'chunk', 'chunk', 'synthesis']);
    expect(claude.calls).toHaveLength(4);
    expect(claude.calls[0]!.addDirs[0]).toContain(path.join('slides', deck.id));
    const fronts = repo.listNotes(db, { deckId: deck.id }).map((n) => n.front);
    // Q1 wurde von der Synthese als Duplikat entfernt, die Verknüpfungskarte kam dazu
    expect(fronts).toEqual(['Q2', 'Q3', 'Q4', 'Q5', 'Compare A and B']);
  });

  it('wiederholt bei ungültigem JSON und gibt nach 3 Versuchen auf', async () => {
    const bad: ClaudeResult = { ok: true, output: { nope: 1 } };
    const { db, deck, drain } = await setup({ 1: bad, 2: bad, 3: bad });
    enqueueDeck(db, deck.id);
    await drain();
    const chunk1 = listJobs(db, deck.id).find((j) => j.kind === 'chunk')!;
    expect(chunk1).toMatchObject({ status: 'failed', attempts: 3 });
    expect(repo.getDeck(db, deck.id)).toMatchObject({ status: 'ready', error: '1 Abschnitt(e) fehlgeschlagen' });
    retryJob(db, chunk1.id);
    await drain();
    expect(listJobs(db, deck.id).find((j) => j.id === chunk1.id)!.status).toBe('done');
    expect(repo.getDeck(db, deck.id)!.error).toBeNull();
  });

  it('pausiert bei fehlendem Login, bis fortgesetzt wird', async () => {
    const { db, deck, worker, drain } = await setup({ 1: { ok: false, kind: 'auth', message: 'Not logged in' } });
    enqueueDeck(db, deck.id);
    await drain();
    expect(worker.status()).toMatchObject({ state: 'paused', pausedUntil: null });
    expect(worker.status().pauseReason).toContain('nicht eingeloggt');
    expect(listJobs(db, deck.id).find((j) => j.kind === 'chunk')!).toMatchObject({ status: 'queued', attempts: 0 });
    worker.resume();
    await drain();
    expect(repo.getDeck(db, deck.id)!.status).toBe('ready');
  });

  it('wartet bei Rate-Limit 5 Minuten', async () => {
    const { db, deck, worker, drain, advance } = await setup({ 1: { ok: false, kind: 'rate_limit', message: 'limit' } });
    enqueueDeck(db, deck.id);
    await drain();
    expect(worker.status().state).toBe('paused');
    expect(await worker.tick()).toBe(false);
    advance(300_001);
    await drain();
    expect(repo.getDeck(db, deck.id)!.status).toBe('ready');
  });

  it('setzt laufende Jobs nach Neustart zurück', async () => {
    const { db, deck } = await setup();
    enqueueDeck(db, deck.id);
    db.prepare("UPDATE job SET status = 'running'").run();
    resetRunningJobs(db);
    expect(listJobs(db, deck.id)[0]!.status).toBe('queued');
  });

  it('regenerateDeck behält bewertete Karten', async () => {
    const { db, deck, drain } = await setup();
    enqueueDeck(db, deck.id);
    await drain();
    const keep = repo.listNotes(db, { deckId: deck.id })[0]!;
    repo.insertRevlog(db, { id: 'r1', cardId: keep.cards[0]!.id, rating: 3, reviewedAt: 1, durationMs: 1, deviceId: 'x', revokes: null });
    regenerateDeck(db, deck.id);
    expect(repo.listNotes(db, { deckId: deck.id }).map((n) => n.id)).toEqual([keep.id]);
    await drain();
    expect(repo.listNotes(db, { deckId: deck.id }).length).toBeGreaterThan(1);
  });
});

describe('sanitizeNote', () => {
  const base = { kind: 'qa' as const, front: 'F', back: 'B', slides: [2], frontImagePage: null, tags: ['t'] };
  it('verwirft Foliennummern außerhalb des Decks und nutzt die Ersatzfolie', () => {
    expect(sanitizeNote({ ...base, slides: [0, 99] }, 10, 4)!.slideRefs).toEqual([4]);
  });
  it('wandelt Lückentext ohne Lücke in Frage/Antwort um', () => {
    expect(sanitizeNote({ ...base, kind: 'cloze', front: 'ohne Lücke' }, 10, 1)!.kind).toBe('qa');
  });
  it('wandelt Diagramm-Karte ohne gültige Seite in Frage/Antwort um', () => {
    const n = sanitizeNote({ ...base, kind: 'diagram', frontImagePage: 42 }, 10, 1)!;
    expect(n).toMatchObject({ kind: 'qa', frontImagePage: null });
  });
  it('verwirft Karten ohne Inhalt', () => {
    expect(sanitizeNote({ ...base, front: '   ' }, 10, 1)).toBeNull();
  });
});
```

Run: `nix develop -c npm test -w @kartei/server -- generation`
Expected: FAIL – `../src/generation.ts` fehlt.

- [ ] **Step 2: Implementierung**

`apps/server/src/generation.ts`:
```ts
import {
  ChunkOutputSchema, SynthesisOutputSchema, clozeOrdinals, newId,
  type GeneratedNote, type NoteKind,
} from '@kartei/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ClaudeResult, RunClaude } from './claude.ts';
import { tx, type Db } from './db.ts';
import { renderPdf, type RenderedSlide } from './pdf.ts';
import { buildChunkPrompt, buildSynthesisPrompt, chunkJsonSchema, outlineOf, synthesisJsonSchema } from './prompt.ts';
import * as repo from './repo.ts';

export const CHUNK_SIZE = 15;
export const MAX_ATTEMPTS = 3;
export const RATE_LIMIT_BACKOFF_MS = [300_000, 900_000, 3_600_000];
const SYNTHESIS_POSITION_BASE = 1_000_000;

export interface Job {
  id: string;
  deckId: string;
  kind: 'render' | 'chunk' | 'synthesis';
  chunkFrom: number | null;
  chunkTo: number | null;
  status: 'queued' | 'running' | 'done' | 'failed';
  attempts: number;
  error: string | null;
  createdAt: number;
}

export interface WorkerStatus {
  state: 'idle' | 'running' | 'paused';
  pauseReason: string | null;
  pausedUntil: number | null;
  current: { jobId: string; deckId: string; kind: Job['kind'] } | null;
  queued: number;
}

export interface Worker {
  tick(): Promise<boolean>;
  start(): void;
  stop(): Promise<void>;
  status(): WorkerStatus;
  resume(): void;
  wake(): void;
}

type Row = Record<string, any>;

const toJob = (r: Row): Job => ({
  id: r.id, deckId: r.deck_id, kind: r.kind, chunkFrom: r.chunk_from ?? null, chunkTo: r.chunk_to ?? null,
  status: r.status, attempts: r.attempts, error: r.error ?? null, createdAt: r.created_at,
});

function insertJob(db: Db, deckId: string, kind: Job['kind'], from: number | null, to: number | null, now: number): void {
  db.prepare("INSERT INTO job (id, deck_id, kind, chunk_from, chunk_to, status, created_at) VALUES (?, ?, ?, ?, ?, 'queued', ?)")
    .run(newId(), deckId, kind, from, to, now);
}

function insertGenerationJobs(db: Db, deckId: string, pageCount: number, chunkSize: number, now: number): void {
  for (let from = 1; from <= pageCount; from += chunkSize) {
    insertJob(db, deckId, 'chunk', from, Math.min(pageCount, from + chunkSize - 1), now);
  }
  insertJob(db, deckId, 'synthesis', null, null, now);
}

export function listJobs(db: Db, deckId: string): Job[] {
  return (db.prepare('SELECT * FROM job WHERE deck_id = ? ORDER BY rowid').all(deckId) as Row[]).map(toJob);
}

export function enqueueDeck(db: Db, deckId: string, now = Date.now()): void {
  tx(db, () => {
    insertJob(db, deckId, 'render', null, null, now);
    repo.updateDeck(db, deckId, { status: 'pending', error: null }, now);
  });
}

export function regenerateDeck(db: Db, deckId: string, now = Date.now(), chunkSize = CHUNK_SIZE): void {
  tx(db, () => {
    for (const id of repo.unreviewedNoteIds(db, deckId)) repo.deleteNote(db, id, now);
    db.prepare("DELETE FROM job WHERE deck_id = ? AND status IN ('queued', 'failed', 'done')").run(deckId);
    const deck = repo.getDeck(db, deckId)!;
    if (deck.pageCount > 0) {
      insertGenerationJobs(db, deckId, deck.pageCount, chunkSize, now);
      repo.updateDeck(db, deckId, { status: 'generating', error: null }, now);
    } else {
      insertJob(db, deckId, 'render', null, null, now);
      repo.updateDeck(db, deckId, { status: 'pending', error: null }, now);
    }
  });
}

export function retryJob(db: Db, jobId: string): void {
  const r = db.prepare('SELECT * FROM job WHERE id = ?').get(jobId) as Row | undefined;
  if (!r) throw new Error(`Job ${jobId} nicht gefunden`);
  db.prepare("UPDATE job SET status = 'queued', attempts = 0, error = NULL WHERE id = ?").run(jobId);
  repo.updateDeck(db, r.deck_id, { status: r.kind === 'render' ? 'pending' : 'generating', error: null });
}

export function resetRunningJobs(db: Db): void {
  db.prepare("UPDATE job SET status = 'queued' WHERE status = 'running'").run();
}

/** Bereinigt eine von Claude erzeugte Note; null = verwerfen. */
export function sanitizeNote(n: GeneratedNote, pageCount: number, fallbackPage: number) {
  const front = n.front.trim();
  if (!front) return null;
  const valid = (p: number) => Number.isInteger(p) && p >= 1 && p <= pageCount;
  const slides = [...new Set(n.slides.filter(valid))];
  let kind: NoteKind = n.kind;
  let frontImagePage = n.frontImagePage;
  if (kind === 'cloze' && clozeOrdinals(front).length === 0) kind = 'qa';
  if (kind === 'diagram' && (frontImagePage === null || !valid(frontImagePage))) kind = 'qa';
  if (kind !== 'diagram') frontImagePage = null;
  return {
    kind,
    front,
    back: n.back.trim(),
    slideRefs: slides.length ? slides : [fallbackPage],
    frontImagePage,
    tags: n.tags.slice(0, 5),
  };
}

export function createWorker(deps: {
  db: Db;
  dataDir: string;
  runClaude: RunClaude;
  render?: (pdf: string, out: string) => Promise<RenderedSlide[]>;
  now?: () => number;
  chunkSize?: number;
}): Worker {
  const { db, dataDir, runClaude } = deps;
  const render = deps.render ?? renderPdf;
  const now = deps.now ?? Date.now;
  const chunkSize = deps.chunkSize ?? CHUNK_SIZE;

  let paused = false;
  let pauseReason: string | null = null;
  let pausedUntil: number | null = null;
  let rateStrikes = 0;
  let current: WorkerStatus['current'] = null;
  let stopped = true;
  let loopDone: Promise<void> = Promise.resolve();
  let wakeUp: (() => void) | null = null;

  const slidesDir = (deckId: string) => path.join(dataDir, 'slides', deckId);

  function pause(reason: string, until: number | null) {
    paused = true;
    pauseReason = reason;
    pausedUntil = until;
  }

  function finalizeDeck(deckId: string) {
    const jobs = listJobs(db, deckId);
    if (jobs.some((j) => j.status === 'queued' || j.status === 'running')) return;
    const chunks = jobs.filter((j) => j.kind === 'chunk');
    const failed = chunks.filter((j) => j.status === 'failed').length;
    if (chunks.length > 0 && failed === chunks.length) {
      repo.updateDeck(db, deckId, { status: 'error', error: 'Alle Abschnitte fehlgeschlagen' }, now());
    } else if (chunks.length > 0) {
      repo.updateDeck(db, deckId, { status: 'ready', error: failed ? `${failed} Abschnitt(e) fehlgeschlagen` : null }, now());
    }
  }

  function setJob(id: string, fields: { status: Job['status']; attempts?: number; error?: string | null }) {
    db.prepare('UPDATE job SET status = ?, attempts = COALESCE(?, attempts), error = ? WHERE id = ?')
      .run(fields.status, fields.attempts ?? null, fields.error ?? null, id);
  }

  /** Gemeinsame Fehlerbehandlung für Claude-Jobs. */
  function handleFailure(job: Job, r: Extract<ClaudeResult, { ok: false }>) {
    if (r.kind === 'auth') {
      setJob(job.id, { status: 'queued', error: r.message });
      pause('claude ist nicht eingeloggt – bitte `claude` im Terminal starten und anmelden, dann „Fortsetzen“.', null);
      return;
    }
    if (r.kind === 'rate_limit') {
      setJob(job.id, { status: 'queued', error: r.message });
      const wait = RATE_LIMIT_BACKOFF_MS[Math.min(rateStrikes, RATE_LIMIT_BACKOFF_MS.length - 1)]!;
      rateStrikes++;
      pause(`Rate-Limit erreicht – neuer Versuch in ${Math.round(wait / 60_000)} min.`, now() + wait);
      return;
    }
    const attempts = job.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      setJob(job.id, { status: 'failed', attempts, error: r.message });
      finalizeDeck(job.deckId);
    } else {
      setJob(job.id, { status: 'queued', attempts, error: r.message });
    }
  }

  async function callClaude(prompt: string, jsonSchema: object, deckId: string): Promise<ClaudeResult> {
    const cwd = await mkdtemp(path.join(tmpdir(), 'kartei-claude-'));
    try {
      return await runClaude({ prompt, jsonSchema, addDirs: [slidesDir(deckId)], cwd });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }

  async function doRender(job: Job) {
    const deck = repo.getDeck(db, job.deckId);
    if (!deck) return setJob(job.id, { status: 'failed', error: 'Foliensatz gelöscht' });
    repo.updateDeck(db, deck.id, { status: 'rendering' }, now());
    try {
      const slides = await render(path.join(dataDir, 'pdfs', `${deck.pdfSha256}.pdf`), slidesDir(deck.id));
      tx(db, () => {
        repo.replaceSlides(db, deck.id, slides.map((s) => ({ deckId: deck.id, ...s })));
        repo.updateDeck(db, deck.id, { pageCount: slides.length, status: 'generating', error: null }, now());
        insertGenerationJobs(db, deck.id, slides.length, chunkSize, now());
        setJob(job.id, { status: 'done' });
      });
    } catch (e) {
      setJob(job.id, { status: 'failed', attempts: job.attempts + 1, error: String(e) });
      repo.updateDeck(db, deck.id, { status: 'error', error: `PDF konnte nicht gelesen werden: ${String(e).slice(0, 300)}` }, now());
    }
  }

  async function doChunk(job: Job) {
    const deck = repo.getDeck(db, job.deckId);
    const mod = deck && repo.getModule(db, deck.moduleId);
    if (!deck || !mod) return setJob(job.id, { status: 'failed', error: 'Foliensatz oder Modul gelöscht' });
    const all = repo.listSlides(db, deck.id);
    const part = all.filter((s) => s.page >= job.chunkFrom! && s.page <= job.chunkTo!);
    const prompt = buildChunkPrompt({
      language: mod.language,
      deckTitle: deck.title,
      outline: outlineOf(all),
      slides: part.map((s) => ({ page: s.page, text: s.text, imagePath: path.join(slidesDir(deck.id), s.image) })),
    });
    const r = await callClaude(prompt, chunkJsonSchema, deck.id);
    if (!r.ok) return handleFailure(job, r);
    const parsed = ChunkOutputSchema.safeParse(r.output);
    if (!parsed.success) return handleFailure(job, { ok: false, kind: 'invalid', message: 'Antwort passt nicht zum Schema' });
    rateStrikes = 0;
    tx(db, () => {
      parsed.data.notes.forEach((n, i) => {
        const clean = sanitizeNote(n, deck.pageCount, job.chunkFrom!);
        if (clean) repo.insertNote(db, { deckId: deck.id, source: 'chunk', position: job.chunkFrom! * 1000 + i, ...clean }, now());
      });
      setJob(job.id, { status: 'done', attempts: job.attempts + 1 });
    });
    finalizeDeck(deck.id);
  }

  async function doSynthesis(job: Job) {
    const deck = repo.getDeck(db, job.deckId);
    const mod = deck && repo.getModule(db, deck.moduleId);
    if (!deck || !mod) return setJob(job.id, { status: 'failed', error: 'Foliensatz oder Modul gelöscht' });
    const notes = repo.listNotes(db, { deckId: deck.id, limit: 5000 });
    const prompt = buildSynthesisPrompt({
      language: mod.language,
      deckTitle: deck.title,
      slides: repo.listSlides(db, deck.id),
      existing: notes.map((n) => ({ id: n.id, front: n.front })),
    });
    const r = await callClaude(prompt, synthesisJsonSchema, deck.id);
    if (!r.ok) return handleFailure(job, r);
    const parsed = SynthesisOutputSchema.safeParse(r.output);
    if (!parsed.success) return handleFailure(job, { ok: false, kind: 'invalid', message: 'Antwort passt nicht zum Schema' });
    rateStrikes = 0;
    const removable = new Set(repo.unreviewedNoteIds(db, deck.id));
    tx(db, () => {
      for (const id of parsed.data.removeNoteIds) if (removable.has(id)) repo.deleteNote(db, id, now());
      parsed.data.notes.forEach((n, i) => {
        const clean = sanitizeNote(n, deck.pageCount, 1);
        if (clean) repo.insertNote(db, { deckId: deck.id, source: 'synthesis', position: SYNTHESIS_POSITION_BASE + i, ...clean }, now());
      });
      setJob(job.id, { status: 'done', attempts: job.attempts + 1 });
    });
    finalizeDeck(deck.id);
  }

  async function tick(): Promise<boolean> {
    if (paused) {
      if (pausedUntil === null || now() < pausedUntil) return false;
      paused = false;
      pauseReason = null;
      pausedUntil = null;
    }
    const row = db.prepare("SELECT * FROM job WHERE status = 'queued' ORDER BY rowid LIMIT 1").get() as Row | undefined;
    if (!row) return false;
    const job = toJob(row);
    setJob(job.id, { status: 'running', error: job.error });
    current = { jobId: job.id, deckId: job.deckId, kind: job.kind };
    try {
      if (job.kind === 'render') await doRender(job);
      else if (job.kind === 'chunk') await doChunk(job);
      else await doSynthesis(job);
    } catch (e) {
      handleFailure(job, { ok: false, kind: 'failed', message: String(e) });
    } finally {
      current = null;
    }
    return true;
  }

  async function loop() {
    while (!stopped) {
      const worked = await tick().catch((e) => {
        console.error('[kartei] Worker-Fehler', e);
        return false;
      });
      if (!worked && !stopped) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 2000);
          wakeUp = () => {
            clearTimeout(t);
            resolve();
          };
        });
        wakeUp = null;
      }
    }
  }

  return {
    tick,
    start() {
      if (!stopped) return;
      stopped = false;
      loopDone = loop();
    },
    async stop() {
      stopped = true;
      wakeUp?.();
      await loopDone;
    },
    status() {
      const { n } = db.prepare("SELECT COUNT(*) AS n FROM job WHERE status = 'queued'").get() as Row;
      return {
        state: paused ? 'paused' : current ? 'running' : 'idle',
        pauseReason,
        pausedUntil,
        current,
        queued: n,
      };
    },
    resume() {
      paused = false;
      pauseReason = null;
      pausedUntil = null;
      rateStrikes = 0;
      wakeUp?.();
    },
    wake() {
      wakeUp?.();
    },
  };
}
```

- [ ] **Step 3: Tests laufen lassen**

Run: `nix develop -c npm test -w @kartei/server -- generation`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(server): generation job queue with retries, pause and synthesis"
```

---

### Task 9: Lern-Service (nächste Karte, Bewerten, Rückgängig, Statistik)

**Files:**
- Create: `apps/server/src/study.ts`
- Test: `apps/server/test/study.test.ts`

**Interfaces:**
- Consumes: repo (Task 5), core `nextCard`, `moduleStats`, `streak`, `replay`, `effectiveLogs`, `previewIntervals`, `formatInterval`, `effectiveDueMs`, `toStudyCard`, `studyDay`, `newId`.
- Produces:
  - `getNext(db: Db, scope: Scope, now: number): { card: StudyCard | null; counts: QueueCounts }`
  - `answer(db: Db, i: { cardId: string; rating: Grade; durationMs: number; deviceId: string; now: number }): { revlogId: string }`
  - `undo(db: Db, revlogId: string, deviceId: string, now: number): void`
  - `recomputeCard(db: Db, cardId: string): void`
  - `interface Overview { studiedToday: number; streak: number; modules: (ModuleStats & { name: string; language: Language; examDate: string | null; newPerDay: number })[] }`
  - `getOverview(db: Db, now: number): Overview`

- [ ] **Step 1: Failing Tests**

`apps/server/test/study.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import * as repo from '../src/repo.ts';
import { answer, getNext, getOverview, undo } from '../src/study.ts';
import { memDb } from './helpers.ts';

const NOW = new Date('2026-10-06T10:00:00+09:00').getTime();
const MIN = 60_000;

function setup(examDate: string | null = null) {
  const db = memDb();
  const mod = repo.createModule(db, { name: 'UIUX', language: 'en', examDate });
  const deck = repo.createDeck(db, { moduleId: mod.id, title: 'Ch1', pdfSha256: 's' });
  const base = { deckId: deck.id, back: 'A', slideRefs: [1], frontImagePage: null, tags: [], source: 'chunk' as const };
  const n1 = repo.insertNote(db, { ...base, kind: 'qa', front: 'Q1', position: 1 });
  const n2 = repo.insertNote(db, { ...base, kind: 'qa', front: 'Q2', position: 2 });
  return { db, mod, deck, n1, n2 };
}

describe('Lern-Service', () => {
  it('liefert die erste neue Karte mit Intervallen und Kontext', () => {
    const { db } = setup();
    const r = getNext(db, {}, NOW);
    expect(r.card).toMatchObject({ front: 'Q1', moduleName: 'UIUX', deckTitle: 'Ch1', intervals: { 1: '1m', 2: '6m', 3: '10m' } });
    expect(r.counts).toEqual({ learning: 0, review: 0, new: 2 });
  });

  it('Bewerten verschiebt die Karte in die Lernphase, Rückgängig stellt sie wieder her', () => {
    const { db } = setup();
    const first = getNext(db, {}, NOW).card!;
    const { revlogId } = answer(db, { cardId: first.cardId, rating: 3, durationMs: 4000, deviceId: 'laptop', now: NOW });
    const after = getNext(db, {}, NOW + MIN);
    expect(after.card!.front).toBe('Q2');
    expect(after.counts).toEqual({ learning: 1, review: 0, new: 1 });
    expect(getOverview(db, NOW + MIN).studiedToday).toBe(1);

    undo(db, revlogId, 'laptop', NOW + 2 * MIN);
    const restored = getNext(db, {}, NOW + 2 * MIN);
    expect(restored.card!.front).toBe('Q1');
    expect(restored.counts).toEqual({ learning: 0, review: 0, new: 2 });
    expect(getOverview(db, NOW + 2 * MIN).studiedToday).toBe(0);
  });

  it('Rückgängig einer unbekannten oder bereits zurückgenommenen Bewertung schlägt fehl', () => {
    const { db } = setup();
    const c = getNext(db, {}, NOW).card!;
    const { revlogId } = answer(db, { cardId: c.cardId, rating: 3, durationMs: 1, deviceId: 'l', now: NOW });
    undo(db, revlogId, 'l', NOW + 1);
    expect(() => undo(db, revlogId, 'l', NOW + 2)).toThrow();
    expect(() => undo(db, 'gibt-es-nicht', 'l', NOW + 2)).toThrow();
  });

  it('Übersicht enthält Modulstatistik und Serie', () => {
    const { db, mod } = setup('2026-10-30');
    const c = getNext(db, {}, NOW).card!;
    answer(db, { cardId: c.cardId, rating: 4, durationMs: 1, deviceId: 'l', now: NOW });
    const o = getOverview(db, NOW + MIN);
    expect(o.streak).toBe(1);
    expect(o.modules[0]).toMatchObject({ moduleId: mod.id, name: 'UIUX', total: 2, new: 1, review: 1, seenPct: 50, daysToExam: 24 });
  });

  it('Intervall-Vorschau berücksichtigt die Prüfungs-Obergrenze', () => {
    const { db } = setup('2026-10-09');
    const c = getNext(db, {}, NOW).card!;
    answer(db, { cardId: c.cardId, rating: 4, durationMs: 1, deviceId: 'l', now: NOW });
    // nach "Einfach" wäre die Karte > 3 Tage weg, darf aber höchstens bis 08.10. reichen
    const due = repo.studyRows(db).find((r) => r.cardId === c.cardId)!;
    expect(due.state.state).toBe(2);
    const later = getNext(db, { deckId: due.deckId }, new Date('2026-10-08T05:00:00+09:00').getTime());
    expect(later.counts.review).toBe(1);
  });
});
```

Run: `nix develop -c npm test -w @kartei/server -- study`
Expected: FAIL – `../src/study.ts` fehlt.

- [ ] **Step 2: Implementierung**

`apps/server/src/study.ts`:
```ts
import {
  effectiveDueMs, effectiveLogs, formatInterval, moduleStats, newId, nextCard, previewIntervals, replay,
  streak, studyDay, toStudyCard,
  type Grade, type Language, type ModuleStats, type QueueCounts, type QueueModule, type Scope, type StudyCard,
} from '@kartei/core';
import { tx, type Db } from './db.ts';
import * as repo from './repo.ts';

function queueModules(db: Db): QueueModule[] {
  return repo.listModules(db).map((m) => ({ id: m.id, examDate: m.examDate, newPerDay: m.newPerDay }));
}

export function getNext(db: Db, scope: Scope, now: number): { card: StudyCard | null; counts: QueueCounts } {
  const mods = repo.listModules(db);
  const { next, counts } = nextCard(repo.studyRows(db), queueModules(db), scope, now);
  if (!next) return { card: null, counts };
  const note = repo.getNote(db, next.noteId)!;
  const card = repo.getCard(db, next.cardId)!;
  const deck = repo.getDeck(db, next.deckId)!;
  const mod = mods.find((m) => m.id === next.moduleId)!;
  const raw = previewIntervals(next.state, now, (s) => effectiveDueMs(s, next.cardId, mod.examDate, now));
  const intervals = {
    1: formatInterval(raw[1]), 2: formatInterval(raw[2]), 3: formatInterval(raw[3]), 4: formatInterval(raw[4]),
  };
  return { card: toStudyCard({ note, card, moduleName: mod.name, deckTitle: deck.title, intervals }), counts };
}

export function recomputeCard(db: Db, cardId: string): void {
  const logs = repo.listRevlogForCard(db, cardId);
  const first = effectiveLogs(logs)[0]?.reviewedAt ?? null;
  repo.saveCardState(db, cardId, replay(logs), first);
}

export function answer(
  db: Db,
  i: { cardId: string; rating: Grade; durationMs: number; deviceId: string; now: number },
): { revlogId: string } {
  if (!repo.getCard(db, i.cardId)) throw new Error(`Karte ${i.cardId} nicht gefunden`);
  const id = newId();
  tx(db, () => {
    repo.insertRevlog(db, {
      id, cardId: i.cardId, rating: i.rating, reviewedAt: i.now, durationMs: Math.max(0, Math.round(i.durationMs)),
      deviceId: i.deviceId, revokes: null,
    });
    recomputeCard(db, i.cardId);
  });
  return { revlogId: id };
}

export function undo(db: Db, revlogId: string, deviceId: string, now: number): void {
  const target = repo.getRevlog(db, revlogId);
  if (!target || target.revokes !== null) throw new Error('Bewertung nicht gefunden');
  const already = db.prepare('SELECT 1 FROM revlog WHERE revokes = ?').get(revlogId);
  if (already) throw new Error('Bewertung wurde bereits zurückgenommen');
  tx(db, () => {
    repo.insertRevlog(db, { id: newId(), cardId: target.cardId, rating: 0, reviewedAt: now, durationMs: 0, deviceId, revokes: revlogId });
    recomputeCard(db, target.cardId);
  });
}

export interface Overview {
  studiedToday: number;
  streak: number;
  modules: (ModuleStats & { name: string; language: Language; examDate: string | null; newPerDay: number })[];
}

export function getOverview(db: Db, now: number): Overview {
  const times = repo.allReviewTimes(db);
  const today = studyDay(now);
  const rows = repo.studyRows(db);
  return {
    studiedToday: times.filter((t) => studyDay(t) === today).length,
    streak: streak(times, now),
    modules: repo.listModules(db).map((m) => ({
      ...moduleStats(rows, { id: m.id, examDate: m.examDate, newPerDay: m.newPerDay }, now),
      name: m.name,
      language: m.language,
      examDate: m.examDate,
      newPerDay: m.newPerDay,
    })),
  };
}
```

- [ ] **Step 3: Tests laufen lassen**

Run: `nix develop -c npm test -w @kartei/server -- study`
Expected: PASS. Falls die erwarteten Intervall-Strings für „Schwer“ abweichen, Werte aus Task 2 Step 4 übernehmen.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(server): study service with answer, undo and overview"
```

---

### Task 10: HTTP-API, Konfiguration, Backups, Einstiegspunkt

**Files:**
- Create: `apps/server/src/config.ts`, `apps/server/src/backup.ts`, `apps/server/src/app.ts`, `apps/server/src/main.ts`
- Test: `apps/server/test/app.test.ts`, `apps/server/test/backup.test.ts`

**Interfaces:**
- Consumes: alles aus Tasks 5–9.
- Produces:
  - `interface Config { dataDir: string; port: number; host: string; token: string; deviceId: string; claudePath: string; claudeModel: string | null; webDir: string | null }`, `loadConfig(env?: NodeJS.ProcessEnv): Config`
  - `backupIfDue(db: Db, backupDir: string, now: number, keep?: number): string | null`
  - `buildApp(deps: { db: Db; cfg: Config; worker: Pick<Worker, 'wake' | 'status' | 'resume'>; now?: () => number }): FastifyInstance`
  - HTTP-Routen (alle JSON):

| Methode | Pfad | Body / Query | Antwort |
|---|---|---|---|
| GET | `/api/overview` | – | `Overview` |
| POST | `/api/modules` | `{ name, language, examDate?, newPerDay? }` | `Module` |
| GET | `/api/modules/:id` | – | `{ module: Module, decks: (Deck & { noteCount: number })[] }` |
| PATCH | `/api/modules/:id` | Teilmenge von `{ name, language, examDate, newPerDay }` | `Module` |
| DELETE | `/api/modules/:id` | – | `{ ok: true }` |
| POST | `/api/modules/:id/upload` | multipart, Feld `files` (mehrfach) | `{ created: Deck[], skipped: { file: string, reason: string }[] }` |
| GET | `/api/decks/:id` | – | `{ deck: Deck, jobs: Job[], noteCount: number, moduleName: string }` |
| PATCH | `/api/decks/:id` | `{ title }` | `Deck` |
| DELETE | `/api/decks/:id` | – | `{ ok: true }` |
| POST | `/api/decks/:id/regenerate` | – | `{ ok: true }` |
| POST | `/api/jobs/:id/retry` | – | `{ ok: true }` |
| GET | `/api/worker` | – | `WorkerStatus` |
| POST | `/api/worker/resume` | – | `{ ok: true }` |
| GET | `/api/notes` | `?deckId&moduleId&q&kind` | `NoteListItem[]` |
| PATCH | `/api/notes/:id` | `{ front?, back?, tags? }` | `{ note, cards }` |
| DELETE | `/api/notes/:id` | – | `{ ok: true }` |
| POST | `/api/cards/:id/suspend` | `{ suspended: boolean }` | `{ ok: true }` |
| GET | `/api/study/next` | `?moduleId&deckId` | `{ card: StudyCard \| null, counts }` |
| POST | `/api/study/answer` | `{ cardId, rating (1–4), durationMs }` | `{ revlogId }` |
| POST | `/api/study/undo` | `{ revlogId }` | `{ ok: true }` |
| GET | `/api/slides/:deckId/:file` | `file` = `<n>.jpg` | JPEG |

Fehler: zod-Fehler → 400 `{ error }`, unbekannte IDs → 404 `{ error }`, fehlendes Token (nicht Loopback) → 401.

- [ ] **Step 1: Failing Tests**

`apps/server/test/backup.test.ts`:
```ts
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { backupIfDue } from '../src/backup.ts';
import { openDb } from '../src/db.ts';

describe('backupIfDue', () => {
  it('sichert einmal pro Tag und behält die letzten 7', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'kartei-bak-'));
    const db = openDb(path.join(dir, 'k.db'));
    const backups = path.join(dir, 'backups');
    const now = new Date('2026-10-06T10:00:00+09:00').getTime();
    const file = backupIfDue(db, backups, now)!;
    expect(existsSync(file)).toBe(true);
    expect(backupIfDue(db, backups, now)).toBeNull();
    for (let d = 1; d <= 8; d++) backupIfDue(db, backups, now + d * 86_400_000);
    expect(readdirSync(backups)).toHaveLength(7);
    expect(readdirSync(backups).sort().at(-1)).toBe('kartei-2026-10-14.db');
  });
});
```

`apps/server/test/app.test.ts`:
```ts
import { mkdtemp } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import type { Config } from '../src/config.ts';
import * as repo from '../src/repo.ts';
import { memDb } from './helpers.ts';
import { makePdf } from './makePdf.ts';

async function setup() {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'kartei-app-'));
  for (const d of ['pdfs', 'slides', 'backups']) mkdirSync(path.join(dataDir, d), { recursive: true });
  const cfg: Config = {
    dataDir, port: 0, host: '127.0.0.1', token: 'secret', deviceId: 'laptop',
    claudePath: '/bin/false', claudeModel: null, webDir: null,
  };
  const db = memDb();
  let woke = 0;
  const worker = { wake: () => void woke++, resume: () => {}, status: () => ({ state: 'idle' as const, pauseReason: null, pausedUntil: null, current: null, queued: 0 }) };
  const app = buildApp({ db, cfg, worker });
  return { app, db, cfg, woke: () => woke };
}

function multipart(files: { name: string; data: Buffer }[]) {
  const b = '----kartei' + Date.now();
  const parts = files.map((f) =>
    Buffer.concat([
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      f.data,
      Buffer.from('\r\n'),
    ]),
  );
  return { payload: Buffer.concat([...parts, Buffer.from(`--${b}--\r\n`)]), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}

describe('HTTP-API', () => {
  it('legt Module an, ändert und listet sie in der Übersicht', async () => {
    const { app } = await setup();
    const created = await app.inject({ method: 'POST', url: '/api/modules', payload: { name: 'UI/UX', language: 'en' } });
    expect(created.statusCode).toBe(200);
    const id = created.json().id;
    const patched = await app.inject({ method: 'PATCH', url: `/api/modules/${id}`, payload: { examDate: '2026-10-30' } });
    expect(patched.json().examDate).toBe('2026-10-30');
    const ov = await app.inject({ method: 'GET', url: '/api/overview' });
    expect(ov.json().modules[0]).toMatchObject({ name: 'UI/UX', examDate: '2026-10-30' });
  });

  it('validiert Eingaben', async () => {
    const { app } = await setup();
    const r = await app.inject({ method: 'POST', url: '/api/modules', payload: { name: '', language: 'fr' } });
    expect(r.statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/modules/nope' })).statusCode).toBe(404);
  });

  it('nimmt PDFs an, überspringt Duplikate und Nicht-PDFs', async () => {
    const { app, db, cfg, woke } = await setup();
    const mod = repo.createModule(db, { name: 'M', language: 'en' });
    const pdf = makePdf(['One']);
    const first = await app.inject({ method: 'POST', url: `/api/modules/${mod.id}/upload`, ...multipart([{ name: 'Ch1.pdf', data: pdf }, { name: 'notes.txt', data: Buffer.from('x') }]) });
    expect(first.statusCode).toBe(200);
    expect(first.json().created).toHaveLength(1);
    expect(first.json().created[0]).toMatchObject({ title: 'Ch1', status: 'pending' });
    expect(first.json().skipped).toEqual([{ file: 'notes.txt', reason: 'keine PDF' }]);
    expect(woke()).toBe(1);
    const again = await app.inject({ method: 'POST', url: `/api/modules/${mod.id}/upload`, ...multipart([{ name: 'Kopie.pdf', data: pdf }]) });
    expect(again.json()).toEqual({ created: [], skipped: [{ file: 'Kopie.pdf', reason: 'bereits hochgeladen (Ch1)' }] });
    const deck = first.json().created[0];
    const detail = await app.inject({ method: 'GET', url: `/api/decks/${deck.id}` });
    expect(detail.json().jobs[0]).toMatchObject({ kind: 'render', status: 'queued' });
    expect(cfg.dataDir).toBeTruthy();
  });

  it('verlangt außerhalb von Loopback ein Token', async () => {
    const { app } = await setup();
    const remote = { remoteAddress: '100.64.1.2' };
    expect((await app.inject({ method: 'GET', url: '/api/overview', ...remote })).statusCode).toBe(401);
    const ok = await app.inject({ method: 'GET', url: '/api/overview', headers: { authorization: 'Bearer secret' }, ...remote });
    expect(ok.statusCode).toBe(200);
  });

  it('Lernablauf: nächste Karte, bewerten, rückgängig', async () => {
    const { app, db } = await setup();
    const mod = repo.createModule(db, { name: 'M', language: 'en' });
    const deck = repo.createDeck(db, { moduleId: mod.id, title: 'D', pdfSha256: 's' });
    repo.insertNote(db, { deckId: deck.id, kind: 'qa', front: 'Q', back: 'A', slideRefs: [1], frontImagePage: null, tags: [], source: 'chunk', position: 0 });
    const next = (await app.inject({ method: 'GET', url: `/api/study/next?moduleId=${mod.id}` })).json();
    expect(next.card.front).toBe('Q');
    const ans = await app.inject({ method: 'POST', url: '/api/study/answer', payload: { cardId: next.card.cardId, rating: 3, durationMs: 1200 } });
    expect(ans.json().revlogId).toBeTruthy();
    const bad = await app.inject({ method: 'POST', url: '/api/study/answer', payload: { cardId: next.card.cardId, rating: 7, durationMs: 1 } });
    expect(bad.statusCode).toBe(400);
    const und = await app.inject({ method: 'POST', url: '/api/study/undo', payload: { revlogId: ans.json().revlogId } });
    expect(und.json()).toEqual({ ok: true });
  });

  it('bearbeitet Notes und pausiert Karten', async () => {
    const { app, db } = await setup();
    const mod = repo.createModule(db, { name: 'M', language: 'en' });
    const deck = repo.createDeck(db, { moduleId: mod.id, title: 'D', pdfSha256: 's' });
    const { note, cards } = repo.insertNote(db, { deckId: deck.id, kind: 'cloze', front: '{{c1::A}}', back: '', slideRefs: [1], frontImagePage: null, tags: [], source: 'chunk', position: 0 });
    const upd = await app.inject({ method: 'PATCH', url: `/api/notes/${note.id}`, payload: { front: '{{c1::A}} {{c2::B}}' } });
    expect(upd.json().cards.filter((c: { deleted: boolean }) => !c.deleted)).toHaveLength(2);
    await app.inject({ method: 'POST', url: `/api/cards/${cards[0]!.id}/suspend`, payload: { suspended: true } });
    expect(repo.getCard(db, cards[0]!.id)!.suspended).toBe(true);
    const list = await app.inject({ method: 'GET', url: `/api/notes?moduleId=${mod.id}&q=B` });
    expect(list.json()).toHaveLength(1);
  });

  it('liefert Folienbilder und lehnt ungültige Dateinamen ab', async () => {
    const { app, db, cfg } = await setup();
    const mod = repo.createModule(db, { name: 'M', language: 'en' });
    const deck = repo.createDeck(db, { moduleId: mod.id, title: 'D', pdfSha256: 's' });
    mkdirSync(path.join(cfg.dataDir, 'slides', deck.id), { recursive: true });
    writeFileSync(path.join(cfg.dataDir, 'slides', deck.id, '1.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
    const img = await app.inject({ method: 'GET', url: `/api/slides/${deck.id}/1.jpg` });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect((await app.inject({ method: 'GET', url: `/api/slides/${deck.id}/..%2F..%2Fkartei.db` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/slides/${deck.id}/2.jpg` })).statusCode).toBe(404);
  });
});
```

Run: `nix develop -c npm test -w @kartei/server -- app backup`
Expected: FAIL – Module fehlen.

- [ ] **Step 2: config.ts und backup.ts**

`apps/server/src/config.ts`:
```ts
import { newId } from '@kartei/core';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  dataDir: string;
  port: number;
  host: string;
  token: string;
  deviceId: string;
  claudePath: string;
  claudeModel: string | null;
  webDir: string | null;
}

function defaultWebDir(): string | null {
  const dir = fileURLToPath(new URL('../../client/dist', import.meta.url));
  return existsSync(path.join(dir, 'index.html')) ? dir : null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = path.resolve(env.KARTEI_DATA_DIR ?? path.join(os.homedir(), '.local/share/kartei'));
  for (const d of ['', 'pdfs', 'slides', 'backups']) mkdirSync(path.join(dataDir, d), { recursive: true });

  const file = path.join(dataDir, 'config.json');
  const stored: { token?: string; deviceId?: string } = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  let changed = false;
  if (!stored.token) { stored.token = randomBytes(32).toString('base64url'); changed = true; }
  if (!stored.deviceId) { stored.deviceId = newId(); changed = true; }
  if (changed) writeFileSync(file, JSON.stringify(stored, null, 2), { mode: 0o600 });

  return {
    dataDir,
    port: Number(env.KARTEI_PORT ?? 8742),
    host: env.KARTEI_HOST ?? '0.0.0.0',
    token: stored.token,
    deviceId: stored.deviceId,
    claudePath: env.KARTEI_CLAUDE ?? path.join(os.homedir(), '.local/bin/claude'),
    claudeModel: env.KARTEI_MODEL || null,
    webDir: env.KARTEI_WEB_DIR ?? defaultWebDir(),
  };
}
```

`apps/server/src/backup.ts`:
```ts
import { studyDay } from '@kartei/core';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Db } from './db.ts';

const BACKUP_RE = /^kartei-\d{4}-\d{2}-\d{2}\.db$/;

export function backupIfDue(db: Db, backupDir: string, now: number, keep = 7): string | null {
  mkdirSync(backupDir, { recursive: true });
  const file = path.join(backupDir, `kartei-${studyDay(now)}.db`);
  if (existsSync(file)) return null;
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const files = readdirSync(backupDir).filter((f) => BACKUP_RE.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) rmSync(path.join(backupDir, f));
  return file;
}
```

- [ ] **Step 3: app.ts**

`apps/server/src/app.ts`:
```ts
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z, ZodError } from 'zod';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { enqueueDeck, listJobs, regenerateDeck, retryJob, type Worker } from './generation.ts';
import * as repo from './repo.ts';
import { answer, getNext, getOverview, undo } from './study.ts';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

class NotFound extends Error {}

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ModuleInput = z.object({
  name: z.string().trim().min(1).max(100),
  language: z.enum(['en', 'de']),
  examDate: DateStr.nullable().optional(),
  newPerDay: z.number().int().min(0).max(500).optional(),
});
const ModulePatch = ModuleInput.partial();
const IdParam = z.object({ id: z.string().min(1) });
const NotePatch = z.object({
  front: z.string().min(1).optional(),
  back: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
const NotesQuery = z.object({
  deckId: z.string().optional(),
  moduleId: z.string().optional(),
  q: z.string().optional(),
  kind: z.enum(['qa', 'cloze', 'diagram']).optional(),
});
const ScopeQuery = z.object({ moduleId: z.string().optional(), deckId: z.string().optional() });
const AnswerInput = z.object({
  cardId: z.string().min(1),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  durationMs: z.number().min(0).max(3_600_000),
});

function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new NotFound(`${what} nicht gefunden`);
  return v;
}

export function buildApp(deps: {
  db: Db;
  cfg: Config;
  worker: Pick<Worker, 'wake' | 'status' | 'resume'>;
  now?: () => number;
}): FastifyInstance {
  const { db, cfg, worker } = deps;
  const now = deps.now ?? Date.now;
  const app = Fastify({ logger: false, bodyLimit: 1 << 20 });

  app.register(multipart, { limits: { fileSize: 300 * 1024 * 1024, files: 50 } });
  if (cfg.webDir) app.register(fastifyStatic, { root: cfg.webDir, prefix: '/' });

  app.addHook('onRequest', async (req, reply) => {
    if (LOOPBACK.has(req.socket.remoteAddress ?? '')) return;
    if (req.headers.authorization === `Bearer ${cfg.token}`) return;
    return reply.code(401).send({ error: 'unauthorized' });
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: err.issues.map((i) => i.message).join('; ') });
    if (err instanceof NotFound) return reply.code(404).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: err.message });
    console.error(err);
    return reply.code(500).send({ error: String(err.message ?? err) });
  });

  // ---- Übersicht und Module ----
  app.get('/api/overview', async () => getOverview(db, now()));

  app.post('/api/modules', async (req) => {
    const input = ModuleInput.parse(req.body);
    return repo.createModule(db, input, now());
  });

  app.get('/api/modules/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    const module = must(repo.getModule(db, id), 'Modul');
    const decks = repo.listDecks(db, id).map((d) => ({ ...d, noteCount: repo.countNotes(db, d.id) }));
    return { module, decks };
  });

  app.patch('/api/modules/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    must(repo.getModule(db, id), 'Modul');
    return repo.updateModule(db, id, ModulePatch.parse(req.body), now());
  });

  app.delete('/api/modules/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    must(repo.getModule(db, id), 'Modul');
    repo.deleteModule(db, id, now());
    return { ok: true };
  });

  app.post('/api/modules/:id/upload', async (req) => {
    const { id } = IdParam.parse(req.params);
    const mod = must(repo.getModule(db, id), 'Modul');
    const created = [];
    const skipped: { file: string; reason: string }[] = [];
    for await (const part of req.files()) {
      const buf = await part.toBuffer();
      const file = part.filename;
      if (!file.toLowerCase().endsWith('.pdf') || buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
        skipped.push({ file, reason: 'keine PDF' });
        continue;
      }
      const sha = createHash('sha256').update(buf).digest('hex');
      const dup = repo.findDeckBySha(db, mod.id, sha);
      if (dup) {
        skipped.push({ file, reason: `bereits hochgeladen (${dup.title})` });
        continue;
      }
      await writeFile(path.join(cfg.dataDir, 'pdfs', `${sha}.pdf`), buf);
      const deck = repo.createDeck(db, { moduleId: mod.id, title: file.replace(/\.pdf$/i, ''), pdfSha256: sha }, now());
      enqueueDeck(db, deck.id, now());
      created.push(repo.getDeck(db, deck.id)!);
    }
    if (created.length) worker.wake();
    return { created, skipped };
  });

  // ---- Foliensätze und Jobs ----
  app.get('/api/decks/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    const deck = must(repo.getDeck(db, id), 'Foliensatz');
    return {
      deck,
      jobs: listJobs(db, id),
      noteCount: repo.countNotes(db, id),
      moduleName: repo.getModule(db, deck.moduleId)?.name ?? '',
    };
  });

  app.patch('/api/decks/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    must(repo.getDeck(db, id), 'Foliensatz');
    const { title } = z.object({ title: z.string().trim().min(1).max(200) }).parse(req.body);
    return repo.updateDeck(db, id, { title }, now());
  });

  app.delete('/api/decks/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    must(repo.getDeck(db, id), 'Foliensatz');
    repo.deleteDeck(db, id, now());
    db.prepare("DELETE FROM job WHERE deck_id = ? AND status = 'queued'").run(id);
    return { ok: true };
  });

  app.post('/api/decks/:id/regenerate', async (req) => {
    const { id } = IdParam.parse(req.params);
    must(repo.getDeck(db, id), 'Foliensatz');
    regenerateDeck(db, id, now());
    worker.wake();
    return { ok: true };
  });

  app.post('/api/jobs/:id/retry', async (req) => {
    const { id } = IdParam.parse(req.params);
    try {
      retryJob(db, id);
    } catch {
      throw new NotFound('Job nicht gefunden');
    }
    worker.wake();
    return { ok: true };
  });

  app.get('/api/worker', async () => worker.status());
  app.post('/api/worker/resume', async () => {
    worker.resume();
    return { ok: true };
  });

  // ---- Notes und Karten ----
  app.get('/api/notes', async (req) => repo.listNotes(db, NotesQuery.parse(req.query)));

  app.patch('/api/notes/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    must(repo.getNote(db, id), 'Karte');
    try {
      return repo.updateNote(db, id, NotePatch.parse(req.body), now());
    } catch (e) {
      if (e instanceof ZodError) throw e;
      throw Object.assign(new Error((e as Error).message), { statusCode: 400 });
    }
  });

  app.delete('/api/notes/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    must(repo.getNote(db, id), 'Karte');
    repo.deleteNote(db, id, now());
    return { ok: true };
  });

  app.post('/api/cards/:id/suspend', async (req) => {
    const { id } = IdParam.parse(req.params);
    must(repo.getCard(db, id), 'Karte');
    const { suspended } = z.object({ suspended: z.boolean() }).parse(req.body);
    repo.setCardSuspended(db, id, suspended, now());
    return { ok: true };
  });

  // ---- Lernen ----
  app.get('/api/study/next', async (req) => getNext(db, ScopeQuery.parse(req.query), now()));

  app.post('/api/study/answer', async (req) => {
    const a = AnswerInput.parse(req.body);
    must(repo.getCard(db, a.cardId), 'Karte');
    return answer(db, { ...a, deviceId: cfg.deviceId, now: now() });
  });

  app.post('/api/study/undo', async (req) => {
    const { revlogId } = z.object({ revlogId: z.string().min(1) }).parse(req.body);
    try {
      undo(db, revlogId, cfg.deviceId, now());
    } catch (e) {
      throw new NotFound((e as Error).message);
    }
    return { ok: true };
  });

  // ---- Folienbilder ----
  app.get('/api/slides/:deckId/:file', async (req, reply) => {
    const { deckId, file } = z.object({ deckId: z.string(), file: z.string() }).parse(req.params);
    if (!/^[0-9a-f-]{36}$/.test(deckId) || !/^\d+\.jpg$/.test(file)) throw new NotFound('Bild nicht gefunden');
    const full = path.join(cfg.dataDir, 'slides', deckId, file);
    if (!existsSync(full)) throw new NotFound('Bild nicht gefunden');
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    return reply.type('image/jpeg').send(createReadStream(full));
  });

  return app;
}
```

- [ ] **Step 4: main.ts**

`apps/server/src/main.ts`:
```ts
import path from 'node:path';
import { buildApp } from './app.ts';
import { backupIfDue } from './backup.ts';
import { createClaudeRunner } from './claude.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { createWorker, resetRunningJobs } from './generation.ts';

const cfg = loadConfig();
const db = openDb(path.join(cfg.dataDir, 'kartei.db'));
resetRunningJobs(db);

const worker = createWorker({
  db,
  dataDir: cfg.dataDir,
  runClaude: createClaudeRunner({ claudePath: cfg.claudePath, model: cfg.claudeModel }),
});
worker.start();

const backup = () => {
  try {
    const f = backupIfDue(db, path.join(cfg.dataDir, 'backups'), Date.now());
    if (f) console.log(`[kartei] Sicherung: ${f}`);
  } catch (e) {
    console.error('[kartei] Sicherung fehlgeschlagen', e);
  }
};
backup();
setInterval(backup, 3_600_000).unref();

const app = buildApp({ db, cfg, worker });
await app.listen({ port: cfg.port, host: cfg.host });
console.log(`[kartei] läuft auf http://localhost:${cfg.port} (Daten: ${cfg.dataDir}, Web: ${cfg.webDir ?? 'kein Build'})`);

const shutdown = async () => {
  await worker.stop();
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

- [ ] **Step 5: Tests laufen lassen**

Run: `nix develop -c npm test -w @kartei/server`
Expected: PASS (alle Server-Tests).

- [ ] **Step 6: Rauchtest des echten Servers**

Run:
```bash
nix develop -c bash -c 'KARTEI_DATA_DIR=$PWD/.devdata KARTEI_PORT=8743 timeout 5 node apps/server/src/main.ts & sleep 2; curl -s localhost:8743/api/overview; wait'
```
Expected: `{"studiedToday":0,"streak":0,"modules":[]}` und Startmeldung.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(server): http api, config, backups and entrypoint"
```

---

### Task 11: UI-Paket – Lernansicht

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/vitest.config.ts`
- Create: `packages/ui/src/{index.ts,source.ts,Markdown.tsx,Lightbox.tsx,SlideStrip.tsx,RatingBar.tsx,NoteEditor.tsx,StudyView.tsx,study.css}`
- Test: `packages/ui/test/StudyView.test.tsx`, `packages/ui/test/Markdown.test.tsx`

**Interfaces:**
- Consumes: `StudyCard`, `QueueCounts`, `Scope`, `Grade` aus core.
- Produces:
  - `interface StudyDataSource { next(scope: Scope): Promise<{ card: StudyCard | null; counts: QueueCounts }>; answer(cardId: string, rating: Grade, durationMs: number): Promise<{ revlogId: string }>; undo(revlogId: string): Promise<void>; setSuspended(cardId: string, suspended: boolean): Promise<void>; updateNote(noteId: string, patch: { front: string; back: string }): Promise<void>; slideUrl(deckId: string, page: number): string }`
  - `StudyView(props: { source: StudyDataSource; scope: Scope; title: string; onExit: () => void })`
  - `Markdown(props: { text: string; className?: string })`, `NoteEditor(props: { front: string; back: string; onSave: (front: string, back: string) => Promise<void>; onCancel: () => void })`, `SlideStrip(props: { deckId: string; pages: number[]; slideUrl: (deckId: string, page: number) => string })`, `Lightbox`, `RatingBar`
  - CSS-Datei `@kartei/ui/study.css`

- [ ] **Step 1: Paket anlegen**

`packages/ui/package.json`:
```json
{
  "name": "@kartei/ui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./study.css": "./src/study.css"
  },
  "scripts": { "test": "vitest run" },
  "dependencies": { "@kartei/core": "*" }
}
```

Run:
```bash
nix develop -c npm install -w @kartei/ui react@^19.3.0 react-dom@^19.3.0 marked@^18.1.0 dompurify@^3.4.16
nix develop -c npm install -w @kartei/ui -D @types/react@^19.3.0 @types/react-dom@^19.3.0 @testing-library/react@^16.3.3 @testing-library/dom@^10.4.2 jsdom@^30.1.2 @vitejs/plugin-react@^6.1.2
```

`packages/ui/vitest.config.ts`:
```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom' },
});
```

- [ ] **Step 2: Failing Tests**

`packages/ui/test/Markdown.test.tsx`:
```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../src/Markdown.tsx';

describe('Markdown', () => {
  it('rendert Markdown und erlaubt Lücken-Spans', () => {
    const { container } = render(<Markdown text={'**fett** <span class="cloze">[…]</span>'} />);
    expect(container.querySelector('strong')?.textContent).toBe('fett');
    expect(container.querySelector('span.cloze')).not.toBeNull();
  });
  it('entfernt Skripte und Event-Handler', () => {
    const { container } = render(<Markdown text={'<script>alert(1)</script><img src=x onerror="alert(1)">'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('onerror')).toBeNull();
  });
});
```

`packages/ui/test/StudyView.test.tsx`:
```tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { StudyCard } from '@kartei/core';
import { describe, expect, it, vi } from 'vitest';
import type { StudyDataSource } from '../src/source.ts';
import { StudyView } from '../src/StudyView.tsx';

function card(id: string): StudyCard {
  return {
    cardId: id, noteId: `n${id}`, deckId: 'd', kind: 'qa', front: `Frage ${id}`, back: `Antwort ${id}`,
    frontImagePage: null, slides: [2], moduleName: 'UIUX', deckTitle: 'Ch1',
    intervals: { 1: '1m', 2: '6m', 3: '10m', 4: '3d' }, noteFront: `Frage ${id}`, noteBack: `Antwort ${id}`,
  };
}

function fakeSource(cards: StudyCard[]): StudyDataSource & { answered: unknown[] } {
  const queue = [...cards];
  const answered: unknown[] = [];
  return {
    answered,
    next: vi.fn(async () => ({ card: queue[0] ?? null, counts: { learning: 0, review: 0, new: queue.length } })),
    answer: vi.fn(async (cardId, rating) => {
      answered.push([cardId, rating]);
      queue.shift();
      return { revlogId: `r-${cardId}` };
    }),
    undo: vi.fn(async () => {}),
    setSuspended: vi.fn(async () => {}),
    updateNote: vi.fn(async () => {}),
    slideUrl: (deckId, page) => `/slides/${deckId}/${page}.jpg`,
  };
}

describe('StudyView', () => {
  it('zeigt Vorderseite, deckt per Knopf auf und bewertet per Taste', async () => {
    const src = fakeSource([card('1'), card('2')]);
    render(<StudyView source={src} scope={{}} title="Heute" onExit={() => {}} />);
    expect(await screen.findByText('Frage 1')).toBeTruthy();
    expect(screen.queryByText('Antwort 1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Antwort zeigen/ }));
    expect(screen.getByText('Antwort 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: /10m.*Gut/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Folie 2' })).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(window, { key: '3' });
    });
    expect(src.answered).toEqual([['1', 3]]);
    expect(await screen.findByText('Frage 2')).toBeTruthy();
  });

  it('Leertaste: erst aufdecken, dann „Gut“', async () => {
    const src = fakeSource([card('1')]);
    render(<StudyView source={src} scope={{}} title="Heute" onExit={() => {}} />);
    await screen.findByText('Frage 1');
    await act(async () => { fireEvent.keyDown(window, { key: ' ' }); });
    expect(screen.getByText('Antwort 1')).toBeTruthy();
    await act(async () => { fireEvent.keyDown(window, { key: ' ' }); });
    expect(src.answered).toEqual([['1', 3]]);
  });

  it('ignoriert Bewertungstasten vor dem Aufdecken', async () => {
    const src = fakeSource([card('1')]);
    render(<StudyView source={src} scope={{}} title="Heute" onExit={() => {}} />);
    await screen.findByText('Frage 1');
    await act(async () => { fireEvent.keyDown(window, { key: '1' }); });
    expect(src.answered).toEqual([]);
  });

  it('zeigt den Fertig-Zustand und erlaubt Rückgängig', async () => {
    const src = fakeSource([card('1')]);
    render(<StudyView source={src} scope={{}} title="Heute" onExit={() => {}} />);
    await screen.findByText('Frage 1');
    fireEvent.click(screen.getByRole('button', { name: /Antwort zeigen/ }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Einfach/ })); });
    expect(await screen.findByText(/Geschafft/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Rückgängig/ })); });
    expect(src.undo).toHaveBeenCalledWith('r-1');
  });
});
```

Run: `nix develop -c npm test -w @kartei/ui`
Expected: FAIL – Komponenten fehlen.

- [ ] **Step 3: Implementierung**

`packages/ui/src/source.ts`:
```ts
import type { Grade, QueueCounts, Scope, StudyCard } from '@kartei/core';

export interface StudyDataSource {
  next(scope: Scope): Promise<{ card: StudyCard | null; counts: QueueCounts }>;
  answer(cardId: string, rating: Grade, durationMs: number): Promise<{ revlogId: string }>;
  undo(revlogId: string): Promise<void>;
  setSuspended(cardId: string, suspended: boolean): Promise<void>;
  updateNote(noteId: string, patch: { front: string; back: string }): Promise<void>;
  slideUrl(deckId: string, page: number): string;
}
```

`packages/ui/src/Markdown.tsx`:
```tsx
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo } from 'react';

export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false, breaks: true }) as string), [text]);
  return <div className={`md ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
```

`packages/ui/src/Lightbox.tsx`:
```tsx
import { useEffect, useState } from 'react';

export function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="lightbox" role="dialog" aria-label={alt} onClick={onClose}>
      <img
        src={src}
        alt={alt}
        className={zoom ? 'zoomed' : ''}
        onClick={(e) => {
          e.stopPropagation();
          setZoom((z) => !z);
        }}
      />
      <button className="lightbox-close" onClick={onClose} aria-label="Schließen">×</button>
    </div>
  );
}
```

`packages/ui/src/SlideStrip.tsx`:
```tsx
import { useState } from 'react';
import { Lightbox } from './Lightbox.tsx';

export function SlideStrip({
  deckId,
  pages,
  slideUrl,
}: {
  deckId: string;
  pages: number[];
  slideUrl: (deckId: string, page: number) => string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  if (pages.length === 0) return null;
  return (
    <div className="slide-strip">
      {pages.map((p) => (
        <button key={p} className="slide-thumb" onClick={() => setOpen(p)}>
          <img src={slideUrl(deckId, p)} alt={`Folie ${p}`} loading="lazy" />
          <span>Folie {p}</span>
        </button>
      ))}
      {open !== null && <Lightbox src={slideUrl(deckId, open)} alt={`Folie ${open} groß`} onClose={() => setOpen(null)} />}
    </div>
  );
}
```

`packages/ui/src/RatingBar.tsx`:
```tsx
import type { Grade } from '@kartei/core';

const LABELS: Record<Grade, string> = { 1: 'Nochmal', 2: 'Schwer', 3: 'Gut', 4: 'Einfach' };

export function RatingBar({ intervals, onRate, disabled }: { intervals: Record<Grade, string>; onRate: (g: Grade) => void; disabled?: boolean }) {
  return (
    <div className="rating-bar">
      {([1, 2, 3, 4] as const).map((g) => (
        <button key={g} className={`rate rate-${g}`} disabled={disabled} onClick={() => onRate(g)}>
          <span className="rate-interval">{intervals[g]}</span>
          <span className="rate-label">{LABELS[g]}</span>
        </button>
      ))}
    </div>
  );
}
```

`packages/ui/src/NoteEditor.tsx`:
```tsx
import { useState } from 'react';
import { Markdown } from './Markdown.tsx';

export function NoteEditor({
  front,
  back,
  onSave,
  onCancel,
}: {
  front: string;
  back: string;
  onSave: (front: string, back: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [f, setF] = useState(front);
  const [b, setB] = useState(back);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="modal-backdrop" role="dialog" aria-label="Karte bearbeiten">
      <div className="modal">
        <h3>Karte bearbeiten</h3>
        <label>
          Vorderseite (Lücken: <code>{'{{c1::Text}}'}</code>)
          <textarea value={f} onChange={(e) => setF(e.target.value)} rows={4} />
        </label>
        <label>
          Rückseite
          <textarea value={b} onChange={(e) => setB(e.target.value)} rows={8} />
        </label>
        <details>
          <summary>Vorschau</summary>
          <Markdown text={f} />
          <hr />
          <Markdown text={b} />
        </details>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button onClick={onCancel} disabled={busy}>Abbrechen</button>
          <button
            className="primary"
            disabled={busy || !f.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(f, b);
              } catch (e) {
                setError(String((e as Error).message ?? e));
                setBusy(false);
              }
            }}
          >
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}
```

`packages/ui/src/StudyView.tsx`:
```tsx
import type { Grade, QueueCounts, Scope, StudyCard } from '@kartei/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Markdown } from './Markdown.tsx';
import { NoteEditor } from './NoteEditor.tsx';
import { RatingBar } from './RatingBar.tsx';
import { SlideStrip } from './SlideStrip.tsx';
import type { StudyDataSource } from './source.ts';
import { Lightbox } from './Lightbox.tsx';

export function StudyView({
  source,
  scope,
  title,
  onExit,
}: {
  source: StudyDataSource;
  scope: Scope;
  title: string;
  onExit: () => void;
}) {
  const [card, setCard] = useState<StudyCard | null>(null);
  const [counts, setCounts] = useState<QueueCounts>({ learning: 0, review: 0, new: 0 });
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lastRevlog, setLastRevlog] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [bigFront, setBigFront] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownAt = useRef(Date.now());
  const { moduleId, deckId } = scope;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await source.next({ moduleId, deckId });
      setCard(r.card);
      setCounts(r.counts);
      setRevealed(false);
      shownAt.current = Date.now();
      setError(null);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }, [source, moduleId, deckId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      try {
        await fn();
      } catch (e) {
        setError(String((e as Error).message ?? e));
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  const rate = useCallback(
    (g: Grade) => {
      if (!card || !revealed) return;
      void run(async () => {
        const duration = Math.min(Date.now() - shownAt.current, 60_000);
        const { revlogId } = await source.answer(card.cardId, g, duration);
        setLastRevlog(revlogId);
        await load();
      });
    },
    [card, revealed, run, source, load],
  );

  const undoLast = useCallback(() => {
    if (!lastRevlog) return;
    void run(async () => {
      await source.undo(lastRevlog);
      setLastRevlog(null);
      await load();
    });
  }, [lastRevlog, run, source, load]);

  const suspend = useCallback(() => {
    if (!card) return;
    void run(async () => {
      await source.setSuspended(card.cardId, true);
      await load();
    });
  }, [card, run, source, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing || bigFront) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!card) return;
        if (!revealed) setRevealed(true);
        else rate(3);
      } else if (['1', '2', '3', '4'].includes(e.key)) {
        rate(Number(e.key) as Grade);
      } else if (e.key === 'z') {
        undoLast();
      } else if (e.key === 'e' && card) {
        setEditing(true);
      } else if (e.key === 'p') {
        suspend();
      } else if (e.key === 'Escape') {
        onExit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, revealed, rate, undoLast, suspend, editing, bigFront, onExit]);

  return (
    <div className="study">
      <header className="study-header">
        <button className="link" onClick={onExit}>← Zurück</button>
        <span className="study-title">{title}</span>
        <span className="counts" aria-label="Verbleibend">
          <span className="count-new">{counts.new}</span>
          <span className="count-learning">{counts.learning}</span>
          <span className="count-review">{counts.review}</span>
        </span>
      </header>

      {error && <p className="error">{error}</p>}

      {!loading && !card && (
        <div className="study-done">
          <h2>Geschafft! 🎉</h2>
          <p>Für heute ist hier nichts mehr fällig.</p>
          <div className="study-actions">
            {lastRevlog && <button onClick={undoLast}>Rückgängig</button>}
            <button className="primary" onClick={onExit}>Zurück zur Übersicht</button>
          </div>
        </div>
      )}

      {card && (
        <>
          <div className="study-meta">
            {card.moduleName} · {card.deckTitle}
          </div>
          <article className={`study-card kind-${card.kind}`}>
            {card.frontImagePage !== null && (
              <button className="front-image" onClick={() => setBigFront(true)}>
                <img src={source.slideUrl(card.deckId, card.frontImagePage)} alt={`Folie ${card.frontImagePage} (Vorderseite)`} />
              </button>
            )}
            <Markdown text={card.front} className="front" />
            {revealed && (
              <>
                <hr />
                <Markdown text={card.back} className="back" />
                <SlideStrip deckId={card.deckId} pages={card.slides} slideUrl={source.slideUrl} />
              </>
            )}
          </article>

          <footer className="study-footer">
            {!revealed ? (
              <button className="primary reveal" onClick={() => setRevealed(true)}>
                Antwort zeigen <kbd>Leertaste</kbd>
              </button>
            ) : (
              <RatingBar intervals={card.intervals} onRate={rate} disabled={busy} />
            )}
            <div className="study-tools">
              <button onClick={undoLast} disabled={!lastRevlog || busy}>Rückgängig <kbd>z</kbd></button>
              <button onClick={() => setEditing(true)}>Bearbeiten <kbd>e</kbd></button>
              <button onClick={suspend} disabled={busy}>Pausieren <kbd>p</kbd></button>
            </div>
          </footer>

          {bigFront && card.frontImagePage !== null && (
            <Lightbox
              src={source.slideUrl(card.deckId, card.frontImagePage)}
              alt={`Folie ${card.frontImagePage} groß`}
              onClose={() => setBigFront(false)}
            />
          )}
          {editing && (
            <NoteEditor
              front={card.noteFront}
              back={card.noteBack}
              onCancel={() => setEditing(false)}
              onSave={async (front, back) => {
                await source.updateNote(card.noteId, { front, back });
                setEditing(false);
                await load();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
```

`packages/ui/src/index.ts`:
```ts
export * from './source.ts';
export * from './Markdown.tsx';
export * from './Lightbox.tsx';
export * from './SlideStrip.tsx';
export * from './RatingBar.tsx';
export * from './NoteEditor.tsx';
export * from './StudyView.tsx';
```

`packages/ui/src/study.css`:
```css
.study { max-width: 760px; margin: 0 auto; padding: 12px 16px 160px; }
.study-header { display: flex; align-items: center; gap: 12px; position: sticky; top: 0; padding: 8px 0; background: var(--bg); z-index: 2; }
.study-title { flex: 1; font-weight: 600; }
.counts { display: flex; gap: 10px; font-variant-numeric: tabular-nums; font-weight: 600; }
.count-new { color: var(--new); }
.count-learning { color: var(--learning); }
.count-review { color: var(--review); }
.study-meta { color: var(--muted); font-size: 0.85rem; margin: 8px 0; }
.study-card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 20px; font-size: 1.1rem; line-height: 1.55; }
.study-card hr { border: none; border-top: 1px dashed var(--border); margin: 18px 0; }
.md p { margin: 0.4em 0; }
.md ul, .md ol { padding-left: 1.3em; }
.md code { background: var(--code); padding: 0 4px; border-radius: 4px; }
.cloze { color: var(--accent); font-weight: 700; }
.cloze-answer { color: var(--accent); font-weight: 700; background: var(--accent-soft); border-radius: 4px; padding: 0 3px; }
.front-image { display: block; width: 100%; border: none; padding: 0; background: none; cursor: zoom-in; margin-bottom: 12px; }
.front-image img { width: 100%; border-radius: 8px; border: 1px solid var(--border); }
.slide-strip { display: flex; gap: 10px; overflow-x: auto; margin-top: 16px; padding-bottom: 4px; }
.slide-thumb { flex: 0 0 auto; border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 4px; cursor: zoom-in; color: var(--muted); font-size: 0.75rem; }
.slide-thumb img { display: block; width: 180px; height: auto; border-radius: 4px; }
.study-footer { position: fixed; left: 0; right: 0; bottom: 0; background: var(--bg); border-top: 1px solid var(--border); padding: 10px 16px calc(10px + env(safe-area-inset-bottom)); }
.study-footer > * { max-width: 760px; margin-left: auto; margin-right: auto; }
.reveal { width: 100%; padding: 14px; font-size: 1.05rem; }
.rating-bar { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.rate { display: flex; flex-direction: column; align-items: center; padding: 10px 4px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); color: var(--fg); font-size: 0.95rem; }
.rate-interval { font-size: 0.75rem; color: var(--muted); }
.rate-1 { border-color: var(--again); } .rate-2 { border-color: var(--hard); } .rate-3 { border-color: var(--good); } .rate-4 { border-color: var(--easy); }
.study-tools { display: flex; gap: 8px; justify-content: center; margin-top: 8px; flex-wrap: wrap; }
.study-tools button { font-size: 0.8rem; }
kbd { font-size: 0.7em; color: var(--muted); border: 1px solid var(--border); border-radius: 4px; padding: 0 4px; margin-left: 4px; }
.study-done { text-align: center; padding: 60px 0; }
.study-actions { display: flex; gap: 10px; justify-content: center; }
.lightbox { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.88); display: flex; align-items: center; justify-content: center; z-index: 50; overflow: auto; touch-action: pinch-zoom; }
.lightbox img { max-width: 96vw; max-height: 92vh; cursor: zoom-in; }
.lightbox img.zoomed { max-width: none; max-height: none; width: 200vw; cursor: zoom-out; }
.lightbox-close { position: fixed; top: 12px; right: 16px; font-size: 2rem; background: none; border: none; color: #fff; }
.modal-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); display: flex; align-items: center; justify-content: center; z-index: 40; padding: 16px; }
.modal { background: var(--surface); border-radius: 14px; padding: 20px; width: min(720px, 100%); max-height: 90vh; overflow: auto; }
.modal label { display: block; margin: 10px 0; }
.modal textarea { width: 100%; font: inherit; font-family: ui-monospace, monospace; font-size: 0.9rem; margin-top: 4px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
```

- [ ] **Step 4: Tests laufen lassen**

Run: `nix develop -c npm test -w @kartei/ui`
Expected: PASS (6 Tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): study view with reveal, rating, undo, edit and slide preview"
```

---

### Task 12: Web-Client (Studio)

**Files:**
- Create: `apps/client/package.json`, `apps/client/vite.config.ts`, `apps/client/index.html`
- Create: `apps/client/src/{main.tsx,router.ts,api.ts,styles.css}`
- Create: `apps/client/src/pages/{Home.tsx,ModulePage.tsx,DeckPage.tsx,BrowserPage.tsx,StudyPage.tsx}`
- Test: `apps/client/test/router.test.ts`, `apps/client/test/api.test.ts`

**Interfaces:**
- Consumes: HTTP-API (Task 10), `StudyView`, `StudyDataSource`, `Markdown`, `NoteEditor`, `SlideStrip` (Task 11), core-Typen.
- Produces: Routen `#/`, `#/module/:id`, `#/deck/:id`, `#/browse?moduleId&deckId&q`, `#/study?moduleId&deckId&title`; `parseRoute(hash: string): Route`; `api` (typisierte Fetch-Wrapper), `HttpDataSource`.

- [ ] **Step 1: Paket anlegen**

`apps/client/package.json`:
```json
{
  "name": "@kartei/client",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  },
  "dependencies": { "@kartei/core": "*", "@kartei/ui": "*" }
}
```

Run:
```bash
nix develop -c npm install -w @kartei/client react@^19.3.0 react-dom@^19.3.0
nix develop -c npm install -w @kartei/client -D vite@^8.3.2 @vitejs/plugin-react@^6.1.2 @types/react@^19.3.0 @types/react-dom@^19.3.0
```

`apps/client/vite.config.ts`:
```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:8742' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
```

`apps/client/index.html`:
```html
<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>kartei</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Failing Tests für Router und API**

`apps/client/test/router.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseRoute, href } from '../src/router.ts';

describe('parseRoute', () => {
  it.each([
    ['', { name: 'home', params: {} }],
    ['#/', { name: 'home', params: {} }],
    ['#/module/abc', { name: 'module', params: { id: 'abc' } }],
    ['#/deck/d1', { name: 'deck', params: { id: 'd1' } }],
    ['#/browse?moduleId=m1&q=gulf', { name: 'browse', params: { moduleId: 'm1', q: 'gulf' } }],
    ['#/study?deckId=d1&title=Ch%201', { name: 'study', params: { deckId: 'd1', title: 'Ch 1' } }],
    ['#/unbekannt', { name: 'home', params: {} }],
  ])('%s', (hash, expected) => {
    expect(parseRoute(hash)).toEqual(expected);
  });
  it('href baut Hash-URLs', () => {
    expect(href('study', { moduleId: 'm1', title: 'UI/UX' })).toBe('#/study?moduleId=m1&title=UI%2FUX');
    expect(href('module', { id: 'x' })).toBe('#/module/x');
  });
});
```

`apps/client/test/api.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpDataSource, api } from '../src/api.ts';

afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it('sendet JSON und wirft bei Fehlern die Servermeldung', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'kaputt' }), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.createModule({ name: 'x', language: 'en' })).rejects.toThrow('kaputt');
    expect(fetchMock).toHaveBeenCalledWith('/api/modules', expect.objectContaining({ method: 'POST' }));
  });
  it('HttpDataSource baut Query und Bild-URLs', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ card: null, counts: { learning: 0, review: 0, new: 0 } })));
    vi.stubGlobal('fetch', fetchMock);
    const src = new HttpDataSource();
    await src.next({ moduleId: 'm1' });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/study/next?moduleId=m1');
    expect(src.slideUrl('d1', 3)).toBe('/api/slides/d1/3.jpg');
  });
});
```

Run: `nix develop -c npm test -w @kartei/client`
Expected: FAIL – Module fehlen.

- [ ] **Step 3: router.ts und api.ts**

`apps/client/src/router.ts`:
```ts
import { useEffect, useState } from 'react';

export type RouteName = 'home' | 'module' | 'deck' | 'browse' | 'study';
export interface Route {
  name: RouteName;
  params: Record<string, string>;
}

export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [pathPart, query = ''] = raw.split('?');
  const params: Record<string, string> = Object.fromEntries(new URLSearchParams(query));
  const seg = pathPart!.split('/').filter(Boolean);
  if (seg.length === 0) return { name: 'home', params: {} };
  if ((seg[0] === 'module' || seg[0] === 'deck') && seg[1]) return { name: seg[0], params: { id: seg[1] } };
  if (seg[0] === 'browse' || seg[0] === 'study') return { name: seg[0], params };
  return { name: 'home', params: {} };
}

export function href(name: RouteName, params: Record<string, string | undefined> = {}): string {
  if (name === 'home') return '#/';
  if (name === 'module' || name === 'deck') return `#/${name}/${params.id}`;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, v);
  const s = q.toString();
  return `#/${name}${s ? `?${s}` : ''}`;
}

export function navigate(name: RouteName, params: Record<string, string | undefined> = {}): void {
  window.location.hash = href(name, params);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
```

`apps/client/src/api.ts`:
```ts
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
```

Run: `nix develop -c npm test -w @kartei/client`
Expected: PASS (Router- und API-Tests).

- [ ] **Step 4: Seiten, Einstieg, Styles**

`apps/client/src/main.tsx`:
```tsx
import '@kartei/ui/study.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserPage } from './pages/BrowserPage.tsx';
import { DeckPage } from './pages/DeckPage.tsx';
import { Home } from './pages/Home.tsx';
import { ModulePage } from './pages/ModulePage.tsx';
import { StudyPage } from './pages/StudyPage.tsx';
import { useRoute } from './router.ts';

function App() {
  const route = useRoute();
  switch (route.name) {
    case 'module': return <ModulePage id={route.params.id!} />;
    case 'deck': return <DeckPage id={route.params.id!} />;
    case 'browse': return <BrowserPage params={route.params} />;
    case 'study': return <StudyPage params={route.params} />;
    default: return <Home />;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`apps/client/src/pages/Home.tsx`:
```tsx
import type { Language } from '@kartei/core';
import { useCallback, useEffect, useState } from 'react';
import { api, type Overview } from '../api.ts';
import { href, navigate } from '../router.ts';

export function Home() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<Language>('en');

  const load = useCallback(() => {
    api.overview().then(setOv, (e) => setError(String(e.message)));
  }, []);
  useEffect(load, [load]);

  const totalDue = ov?.modules.reduce((s, m) => s + m.dueToday, 0) ?? 0;

  return (
    <main className="page">
      <header className="topbar">
        <h1>kartei</h1>
        {ov && <span className="muted">Heute gelernt: {ov.studiedToday} · Serie: {ov.streak} {ov.streak === 1 ? 'Tag' : 'Tage'}</span>}
      </header>
      {error && <p className="error">{error}</p>}

      <section className="hero">
        <button className="primary big" disabled={totalDue === 0} onClick={() => navigate('study', { title: 'Heute' })}>
          Heute lernen · {totalDue} Karten
        </button>
        <a href={href('browse')}>Alle Karten durchsuchen</a>
      </section>

      <section className="grid">
        {ov?.modules.map((m) => (
          <a key={m.moduleId} className="tile" href={href('module', { id: m.moduleId })}>
            <div className="tile-head">
              <strong>{m.name}</strong>
              <span className="badge">{m.language.toUpperCase()}</span>
            </div>
            <div className="counts">
              <span className="count-new">{m.new} neu</span>
              <span className="count-learning">{m.learning} lernend</span>
              <span className="count-review">{m.review} wdh.</span>
            </div>
            <div className="progress"><div style={{ width: `${m.seenPct}%` }} /></div>
            <div className="muted small">
              {m.seenPct}% gesehen · heute {m.dueToday} fällig
              {m.daysToExam !== null && <> · Prüfung in {m.daysToExam} {m.daysToExam === 1 ? 'Tag' : 'Tagen'}</>}
            </div>
            {m.warn && <div className="warn small">⚠ {m.newTarget} neue Karten/Tag nötig, um bis 3 Tage vor der Prüfung alles zu sehen</div>}
          </a>
        ))}
      </section>

      <section className="card-form">
        <h2>Neues Modul</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const m = await api.createModule({ name, language });
              navigate('module', { id: m.id });
            } catch (err) {
              setError(String((err as Error).message));
            }
          }}
        >
          <input placeholder="Name, z. B. UI/UX Design" value={name} onChange={(e) => setName(e.target.value)} required />
          <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
            <option value="en">Karten auf Englisch</option>
            <option value="de">Karten auf Deutsch</option>
          </select>
          <button className="primary" type="submit">Anlegen</button>
        </form>
      </section>
    </main>
  );
}
```

`apps/client/src/pages/ModulePage.tsx`:
```tsx
import type { Language, Module } from '@kartei/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type DeckWithCount } from '../api.ts';
import { href, navigate } from '../router.ts';

const STATUS: Record<string, string> = {
  pending: 'wartet', rendering: 'Folien werden gelesen', generating: 'Karten werden erzeugt', ready: 'fertig', error: 'Fehler',
};

export function ModulePage({ id }: { id: string }) {
  const [mod, setMod] = useState<Module | null>(null);
  const [decks, setDecks] = useState<DeckWithCount[]>([]);
  const [form, setForm] = useState({ name: '', language: 'en' as Language, examDate: '', newPerDay: 20 });
  const [msg, setMsg] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.module(id);
      setMod(r.module);
      setDecks(r.decks);
      setForm({ name: r.module.name, language: r.module.language, examDate: r.module.examDate ?? '', newPerDay: r.module.newPerDay });
    } catch (e) {
      setMsg(String((e as Error).message));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const busy = decks.some((d) => d.status !== 'ready' && d.status !== 'error');
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [busy, load]);

  async function upload(files: File[]) {
    if (!files.length) return;
    setMsg(`Lade ${files.length} Datei(en) hoch …`);
    try {
      const r = await api.upload(id, files);
      const skipped = r.skipped.map((s) => `${s.file}: ${s.reason}`).join(', ');
      setMsg(`${r.created.length} Foliensatz/-sätze hinzugefügt.${skipped ? ` Übersprungen: ${skipped}` : ''}`);
      await load();
    } catch (e) {
      setMsg(String((e as Error).message));
    }
  }

  if (!mod) return <main className="page">{msg ?? 'Lade …'}</main>;

  return (
    <main className="page">
      <header className="topbar">
        <a href={href('home')}>← Übersicht</a>
        <h1>{mod.name}</h1>
        <button className="primary" onClick={() => navigate('study', { moduleId: id, title: mod.name })}>Modul lernen</button>
      </header>
      {msg && <p className="info">{msg}</p>}

      <section
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload([...e.dataTransfer.files]);
        }}
        onClick={() => fileInput.current?.click()}
      >
        <p><strong>Foliensätze hierher ziehen</strong> oder klicken (PDF, mehrere möglich)</p>
        <input ref={fileInput} type="file" accept="application/pdf" multiple hidden onChange={(e) => void upload([...(e.target.files ?? [])])} />
      </section>

      <section>
        <h2>Foliensätze</h2>
        <table className="table">
          <thead><tr><th>Titel</th><th>Status</th><th>Folien</th><th>Karten</th><th /></tr></thead>
          <tbody>
            {decks.map((d) => (
              <tr key={d.id}>
                <td><a href={href('deck', { id: d.id })}>{d.title}</a></td>
                <td className={`status-${d.status}`}>{STATUS[d.status]}{d.error ? ` – ${d.error}` : ''}</td>
                <td>{d.pageCount || '–'}</td>
                <td>{d.noteCount}</td>
                <td><button onClick={() => navigate('study', { moduleId: id, deckId: d.id, title: d.title })} disabled={d.noteCount === 0}>Lernen</button></td>
              </tr>
            ))}
            {decks.length === 0 && <tr><td colSpan={5} className="muted">Noch keine Foliensätze.</td></tr>}
          </tbody>
        </table>
        <p><a href={href('browse', { moduleId: id })}>Karten dieses Moduls durchsuchen</a></p>
      </section>

      <section className="card-form">
        <h2>Einstellungen</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.updateModule(id, { name: form.name, language: form.language, examDate: form.examDate || null, newPerDay: form.newPerDay });
              setMsg('Gespeichert.');
              await load();
            } catch (err) {
              setMsg(String((err as Error).message));
            }
          }}
        >
          <label>Name <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
          <label>Kartensprache
            <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as Language })}>
              <option value="en">Englisch</option>
              <option value="de">Deutsch</option>
            </select>
          </label>
          <label>Prüfungsdatum <input type="date" value={form.examDate} onChange={(e) => setForm({ ...form, examDate: e.target.value })} /></label>
          <label>Neue Karten pro Tag (mindestens) <input type="number" min={0} max={500} value={form.newPerDay} onChange={(e) => setForm({ ...form, newPerDay: Number(e.target.value) })} /></label>
          <button className="primary" type="submit">Speichern</button>
        </form>
        <p className="muted small">Die Sprache gilt für neu erzeugte Karten. Mit Prüfungsdatum verteilt kartei die neuen Karten so, dass du 3 Tage vorher alles gesehen hast.</p>
        <button
          className="danger"
          onClick={async () => {
            if (!confirm(`Modul „${mod.name}“ wirklich löschen?`)) return;
            await api.deleteModule(id);
            navigate('home');
          }}
        >
          Modul löschen
        </button>
      </section>
    </main>
  );
}
```

`apps/client/src/pages/DeckPage.tsx`:
```tsx
import type { Deck } from '@kartei/core';
import { Markdown, SlideStrip } from '@kartei/ui';
import { useCallback, useEffect, useState } from 'react';
import { api, type Job, type NoteListItem, type WorkerStatus } from '../api.ts';
import { href, navigate } from '../router.ts';

const KIND: Record<Job['kind'], string> = { render: 'Folien lesen', chunk: 'Karten erzeugen', synthesis: 'Zusammenfassen & Duplikate' };
const JOB_STATUS: Record<Job['status'], string> = { queued: 'wartet', running: 'läuft …', done: 'fertig', failed: 'fehlgeschlagen' };
const slideUrl = (deckId: string, page: number) => `/api/slides/${deckId}/${page}.jpg`;

export function DeckPage({ id }: { id: string }) {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [moduleName, setModuleName] = useState('');
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [worker, setWorker] = useState<WorkerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, w, n] = await Promise.all([api.deck(id), api.worker(), api.notes({ deckId: id })]);
      setDeck(d.deck);
      setJobs(d.jobs);
      setModuleName(d.moduleName);
      setWorker(w);
      setNotes(n);
    } catch (e) {
      setError(String((e as Error).message));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = jobs.some((j) => j.status === 'queued' || j.status === 'running');
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [active, load]);

  if (!deck) return <main className="page">{error ?? 'Lade …'}</main>;
  const done = jobs.filter((j) => j.kind === 'chunk' && j.status === 'done').length;
  const total = jobs.filter((j) => j.kind === 'chunk').length;

  return (
    <main className="page">
      <header className="topbar">
        <a href={href('module', { id: deck.moduleId })}>← {moduleName}</a>
        <h1>{deck.title}</h1>
        <button className="primary" disabled={notes.length === 0} onClick={() => navigate('study', { moduleId: deck.moduleId, deckId: deck.id, title: deck.title })}>Lernen</button>
      </header>
      {error && <p className="error">{error}</p>}

      {worker?.state === 'paused' && (
        <p className="warn">
          Erzeugung pausiert: {worker.pauseReason}{' '}
          <button onClick={async () => { await api.resumeWorker(); await load(); }}>Fortsetzen</button>
        </p>
      )}

      <section>
        <h2>Erzeugung {total > 0 && <span className="muted small">({done}/{total} Abschnitte)</span>}</h2>
        <table className="table">
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td>{KIND[j.kind]}{j.chunkFrom !== null && ` · Folien ${j.chunkFrom}–${j.chunkTo}`}</td>
                <td className={`job-${j.status}`}>{JOB_STATUS[j.status]}{j.attempts > 1 ? ` (Versuch ${j.attempts})` : ''}</td>
                <td className="small muted">{j.status !== 'done' && j.error}</td>
                <td>{j.status === 'failed' && <button onClick={async () => { await api.retryJob(j.id); await load(); }}>Erneut versuchen</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row">
          <button
            disabled={active}
            onClick={async () => {
              if (!confirm('Karten neu erzeugen? Bereits bewertete Karten bleiben erhalten.')) return;
              await api.regenerate(id);
              await load();
            }}
          >
            Neu erzeugen
          </button>
          <button
            onClick={async () => {
              const t = prompt('Neuer Titel', deck.title);
              if (t && t.trim()) { await api.renameDeck(id, t.trim()); await load(); }
            }}
          >
            Umbenennen
          </button>
          <button
            className="danger"
            onClick={async () => {
              if (!confirm(`Foliensatz „${deck.title}“ löschen?`)) return;
              await api.deleteDeck(id);
              navigate('module', { id: deck.moduleId });
            }}
          >
            Löschen
          </button>
        </div>
      </section>

      <section>
        <h2>Karten ({notes.length})</h2>
        <p><a href={href('browse', { deckId: id })}>Im Karten-Browser bearbeiten</a></p>
        <div className="note-list">
          {notes.map((n) => (
            <details key={n.id} className="note">
              <summary>
                <span className={`badge kind-${n.kind}`}>{n.kind}</span> <Markdown text={n.front} className="inline" />
              </summary>
              <Markdown text={n.back} />
              <SlideStrip deckId={n.deckId} pages={n.frontImagePage ? [n.frontImagePage] : n.slideRefs} slideUrl={slideUrl} />
            </details>
          ))}
        </div>
      </section>
    </main>
  );
}
```

`apps/client/src/pages/BrowserPage.tsx`:
```tsx
import type { NoteKind } from '@kartei/core';
import { Markdown, NoteEditor } from '@kartei/ui';
import { useCallback, useEffect, useState } from 'react';
import { api, type NoteListItem } from '../api.ts';
import { href } from '../router.ts';

export function BrowserPage({ params }: { params: Record<string, string> }) {
  const [q, setQ] = useState(params.q ?? '');
  const [kind, setKind] = useState<NoteKind | ''>('');
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [editing, setEditing] = useState<NoteListItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setNotes(await api.notes({ moduleId: params.moduleId, deckId: params.deckId, q: q || undefined, kind: kind || undefined }));
    } catch (e) {
      setError(String((e as Error).message));
    }
  }, [params.moduleId, params.deckId, q, kind]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const back = params.deckId ? href('deck', { id: params.deckId }) : params.moduleId ? href('module', { id: params.moduleId }) : href('home');

  return (
    <main className="page">
      <header className="topbar">
        <a href={back}>← Zurück</a>
        <h1>Karten-Browser</h1>
      </header>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <input placeholder="Suchen …" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <select value={kind} onChange={(e) => setKind(e.target.value as NoteKind | '')}>
          <option value="">Alle Typen</option>
          <option value="qa">Frage/Antwort</option>
          <option value="cloze">Lückentext</option>
          <option value="diagram">Diagramm</option>
        </select>
        <span className="muted">{notes.length} Karten</span>
      </div>
      <table className="table notes-table">
        <tbody>
          {notes.map((n) => {
            const suspended = n.cards.length > 0 && n.cards.every((c) => c.suspended);
            return (
              <tr key={n.id} className={suspended ? 'suspended' : ''}>
                <td><span className={`badge kind-${n.kind}`}>{n.kind}</span></td>
                <td>
                  <Markdown text={n.front} />
                  <details><summary className="muted small">Antwort</summary><Markdown text={n.back} /></details>
                </td>
                <td className="small muted">{n.deckTitle} · Folie {n.slideRefs.join(', ')}</td>
                <td className="actions">
                  <button onClick={() => setEditing(n)}>Bearbeiten</button>
                  <button onClick={async () => {
                    for (const c of n.cards) await api.suspend(c.id, !suspended);
                    await load();
                  }}>{suspended ? 'Fortsetzen' : 'Pausieren'}</button>
                  <button className="danger" onClick={async () => {
                    if (!confirm('Karte löschen?')) return;
                    await api.deleteNote(n.id);
                    await load();
                  }}>Löschen</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {editing && (
        <NoteEditor
          front={editing.front}
          back={editing.back}
          onCancel={() => setEditing(null)}
          onSave={async (front, back) => {
            await api.updateNote(editing.id, { front, back });
            setEditing(null);
            await load();
          }}
        />
      )}
    </main>
  );
}
```

`apps/client/src/pages/StudyPage.tsx`:
```tsx
import { StudyView } from '@kartei/ui';
import { useMemo } from 'react';
import { HttpDataSource } from '../api.ts';
import { navigate } from '../router.ts';

export function StudyPage({ params }: { params: Record<string, string> }) {
  const source = useMemo(() => new HttpDataSource(), []);
  const exit = () => {
    if (params.deckId) navigate('deck', { id: params.deckId });
    else if (params.moduleId) navigate('module', { id: params.moduleId });
    else navigate('home');
  };
  return (
    <StudyView
      source={source}
      scope={{ moduleId: params.moduleId, deckId: params.deckId }}
      title={params.title ?? 'Lernen'}
      onExit={exit}
    />
  );
}
```

`apps/client/src/styles.css`:
```css
:root {
  --bg: #f6f6f3; --surface: #ffffff; --fg: #1d1d1f; --muted: #6b6b70; --border: #dcdcd6; --code: #efefea;
  --accent: #5b4bd6; --accent-soft: #ebe8ff;
  --new: #2f6fde; --learning: #d64545; --review: #2c9a5a;
  --again: #d64545; --hard: #c98a1a; --good: #2c9a5a; --easy: #2f6fde;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #141416; --surface: #1e1e22; --fg: #ececf0; --muted: #9a9aa3; --border: #34343b; --code: #2a2a30;
    --accent: #a89bff; --accent-soft: #2e2a52;
    --new: #6ea0ff; --learning: #ff7b7b; --review: #5fd08f;
    --again: #ff7b7b; --hard: #e3b04b; --good: #5fd08f; --easy: #6ea0ff;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; }
a { color: var(--accent); }
button, input, select { font: inherit; color: inherit; }
button { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 6px 12px; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: default; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.danger { color: var(--again); border-color: var(--again); }
button.link { border: none; background: none; color: var(--accent); padding: 0; }
button.big { font-size: 1.15rem; padding: 14px 22px; }
input, select { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; }
.page { max-width: 1000px; margin: 0 auto; padding: 16px; }
.topbar { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; }
.topbar h1 { flex: 1; margin: 0; font-size: 1.5rem; }
.hero { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; margin: 16px 0 24px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
.tile { display: block; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 16px; color: inherit; text-decoration: none; }
.tile:hover { border-color: var(--accent); }
.tile-head { display: flex; justify-content: space-between; margin-bottom: 8px; }
.tile .counts { display: flex; gap: 10px; font-size: 0.9rem; margin-bottom: 8px; }
.badge { font-size: 0.7rem; border: 1px solid var(--border); border-radius: 6px; padding: 0 6px; color: var(--muted); }
.progress { height: 6px; background: var(--code); border-radius: 3px; overflow: hidden; margin-bottom: 6px; }
.progress > div { height: 100%; background: var(--review); }
.muted { color: var(--muted); }
.small { font-size: 0.85rem; }
.error { color: var(--again); }
.warn { color: var(--hard); }
.info { background: var(--accent-soft); padding: 8px 12px; border-radius: 8px; }
.card-form { margin-top: 28px; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 16px; }
.card-form form { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; }
.card-form label { display: flex; flex-direction: column; font-size: 0.85rem; color: var(--muted); gap: 4px; }
.dropzone { border: 2px dashed var(--border); border-radius: 14px; padding: 28px; text-align: center; cursor: pointer; margin: 12px 0 24px; }
.dropzone.dragging { border-color: var(--accent); background: var(--accent-soft); }
.table { width: 100%; border-collapse: collapse; }
.table td, .table th { border-bottom: 1px solid var(--border); padding: 8px; text-align: left; vertical-align: top; }
.status-error, .job-failed { color: var(--again); }
.status-ready, .job-done { color: var(--review); }
.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 12px 0; }
.note-list .note { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px; margin-bottom: 8px; }
.note summary { cursor: pointer; display: flex; gap: 8px; align-items: baseline; }
.md.inline, .md.inline p { display: inline; margin: 0; }
.notes-table .actions { white-space: nowrap; }
.notes-table .actions button { margin-left: 4px; }
tr.suspended { opacity: 0.5; }
@media (max-width: 640px) {
  .notes-table td:nth-child(3) { display: none; }
  .notes-table .actions { white-space: normal; }
}
```

- [ ] **Step 5: Build und manueller Test**

Run:
```bash
nix develop -c npm run build
nix develop -c npm test
```
Expected: Vite baut nach `apps/client/dist`, alle Tests PASS.

Dann Server mit Build starten und im Browser prüfen:
```bash
nix develop -c bash -c 'KARTEI_DATA_DIR=$PWD/.devdata node apps/server/src/main.ts'
```
Öffnen: `http://localhost:8742` → Modul „Test“ anlegen, eine kleine PDF hochladen (z. B. `~/Documents/Uni/UIUX/3. The process of interaction design (Ch2).pdf`), Fortschritt auf der Foliensatz-Seite beobachten, nach „fertig“ lernen: Leertaste, `1`–`4`, `z`, `e`, Folienvorschau antippen. Server mit Strg+C beenden.

- [ ] **Step 6: Typecheck**

Run: `nix develop -c npm run typecheck`
Expected: keine Fehler. Gefundene Fehler mit reinen Typänderungen beheben (z. B. `@fastify/multipart`-Typen per `import '@fastify/multipart'` laden, `any`-Rows casten); Verhalten nicht ändern, danach `nix develop -c npm test` erneut.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(client): studio web app with modules, upload, decks, browser and study"
```

---

### Task 13: Nix-Paket, Home-Manager-Dienst, Einbindung in die Dotfiles

**Files:**
- Modify: `flake.nix`
- Create: `nix/hm-module.nix`
- Create: `~/nixos/dotfiles/home/luna/modules/kartei/default.nix`
- Modify: `~/nixos/dotfiles/flake.nix` (Input), `~/nixos/dotfiles/home/luna/home.nix` (Import)

**Interfaces:**
- Produces: `packages.x86_64-linux.default` (Binary `kartei-server`), `homeManagerModules.default` mit Optionen `services.kartei.{enable, package, port, dataDir, claudePath, claudeModel}`.

- [ ] **Step 1: Paket und Modul**

`nix/hm-module.nix`:
```nix
self:
{ config, lib, pkgs, ... }:
let
  cfg = config.services.kartei;
in
{
  options.services.kartei = {
    enable = lib.mkEnableOption "kartei Lernkarten-Server";
    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      description = "kartei-Paket.";
    };
    port = lib.mkOption { type = lib.types.port; default = 8742; };
    dataDir = lib.mkOption {
      type = lib.types.str;
      default = "${config.home.homeDirectory}/.local/share/kartei";
    };
    claudePath = lib.mkOption {
      type = lib.types.str;
      default = "${config.home.homeDirectory}/.local/bin/claude";
      description = "Pfad zur claude-CLI (nutzt deren Login).";
    };
    claudeModel = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Optionales Modell für die Kartenerzeugung (null = Standard des Accounts).";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.user.services.kartei = {
      Unit = {
        Description = "kartei Lernkarten-Server";
        After = [ "network-online.target" ];
      };
      Service = {
        ExecStart = "${cfg.package}/bin/kartei-server";
        Environment = [
          "KARTEI_PORT=${toString cfg.port}"
          "KARTEI_DATA_DIR=${cfg.dataDir}"
          "KARTEI_CLAUDE=${cfg.claudePath}"
          "PATH=${config.home.homeDirectory}/.local/bin:/etc/profiles/per-user/${config.home.username}/bin:/run/current-system/sw/bin"
        ] ++ lib.optional (cfg.claudeModel != null) "KARTEI_MODEL=${cfg.claudeModel}";
        Restart = "on-failure";
        RestartSec = 5;
      };
      Install.WantedBy = [ "default.target" ];
    };
  };
}
```

`flake.nix` (vollständig ersetzen):
```nix
{
  description = "kartei – Lernkarten aus Foliensätzen";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      kartei = pkgs.buildNpmPackage {
        pname = "kartei";
        version = "0.1.0";
        src = self;
        nodejs = pkgs.nodejs_24;
        npmDepsHash = pkgs.lib.fakeHash;
        npmBuildScript = "build";
        dontNpmPrune = true;
        nativeBuildInputs = [ pkgs.makeWrapper ];
        installPhase = ''
          runHook preInstall
          mkdir -p $out/lib/kartei $out/bin
          cp -r package.json node_modules packages apps $out/lib/kartei/
          makeWrapper ${pkgs.nodejs_24}/bin/node $out/bin/kartei-server \
            --add-flags $out/lib/kartei/apps/server/src/main.ts \
            --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.poppler-utils ]} \
            --set-default KARTEI_WEB_DIR $out/lib/kartei/apps/client/dist
          runHook postInstall
        '';
      };
    in {
      packages.${system}.default = kartei;
      homeManagerModules.default = import ./nix/hm-module.nix self;
      devShells.${system}.default = pkgs.mkShell {
        packages = [ pkgs.nodejs_24 pkgs.poppler-utils pkgs.prefetch-npm-deps ];
      };
    };
}
```

- [ ] **Step 2: npmDepsHash ermitteln und bauen**

Run:
```bash
git add -A
nix develop -c prefetch-npm-deps package-lock.json
```
Den ausgegebenen Hash in `flake.nix` statt `pkgs.lib.fakeHash` eintragen (als String `"sha256-…"`).

Run: `git add -A && nix build .#default && ls result/bin && test -f result/lib/kartei/apps/client/dist/index.html && echo OK`
Expected: `kartei-server` und `OK`.
Falls der Vite-Build in der Sandbox an einer nativen Bindung scheitert (rolldown/oxc, „cannot open shared object file“): `pkgs.autoPatchelfHook` und `pkgs.stdenv.cc.cc.lib` zu `nativeBuildInputs`/`buildInputs` hinzufügen und erneut bauen.

Rauchtest des gebauten Pakets:
```bash
KARTEI_DATA_DIR=$PWD/.devdata KARTEI_PORT=8743 timeout 5 ./result/bin/kartei-server & sleep 2; curl -s localhost:8743/ | head -c 80; wait
```
Expected: Beginn von `<!doctype html>`.

- [ ] **Step 3: Commit im kartei-Repo**

```bash
git add -A
git commit -m "build: nix package and home-manager service"
```

- [ ] **Step 4: Dotfiles einbinden**

`~/nixos/dotfiles/home/luna/modules/kartei/default.nix`:
```nix
{ inputs, ... }:
{
  imports = [ inputs.kartei.homeManagerModules.default ];
  services.kartei.enable = true;
}
```

In `~/nixos/dotfiles/flake.nix` unter `inputs` nach `vela` ergänzen:
```nix
    kartei = {
      url = "git+file:///home/luna/projects/kartei";
      inputs.nixpkgs.follows = "nixpkgs";
    };
```

In `~/nixos/dotfiles/home/luna/home.nix` in `imports` nach `./modules/claude-desktop` ergänzen:
```nix
    ./modules/kartei
```

Run (in `~/nixos/dotfiles`):
```bash
git add -A
nix flake lock --update-input kartei
nixos-rebuild build --flake .#nixos
```
Expected: Build erfolgreich (kein Switch – den macht Luna mit ihrem `rebuild`-Skript).

- [ ] **Step 5: Übergabe an Luna**

Luna führt aus: `rebuild "kartei service"`. Danach prüfen:
```bash
systemctl --user status kartei --no-pager
curl -s localhost:8742/api/overview
```
Expected: `active (running)`, JSON-Antwort. `http://localhost:8742` im Browser zeigt das Studio.

Hinweis für spätere Updates: im kartei-Repo committen, dann in den Dotfiles `nix flake update kartei` und `rebuild`.

---

### Task 14: Abnahme mit den UIUX-Foliensätzen

**Files:** keine Codeänderungen (nur Fehlerbehebungen, falls nötig – dann mit Test im betroffenen Task-Bereich).

- [ ] **Step 1: Modul anlegen und hochladen**

Im Studio (`http://localhost:8742`): Modul „UI/UX Design“, Sprache Englisch anlegen. Alle 8 PDFs aus `~/Documents/Uni/UIUX/` auf die Upload-Fläche ziehen.
Alternativ per API:
```bash
MID=$(curl -s -X POST localhost:8742/api/modules -H 'content-type: application/json' -d '{"name":"UI/UX Design","language":"en"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
cd ~/Documents/Uni/UIUX && curl -s -X POST localhost:8742/api/modules/$MID/upload $(for f in *.pdf; do printf -- '-F files=@"%s" ' "$f"; done)
```
Expected: 8 Foliensätze mit Status „wartet“/„Folien werden gelesen“.

- [ ] **Step 2: Erzeugung beobachten**

`journalctl --user -u kartei -f` und Foliensatz-Seiten. Jeder Foliensatz endet mit Status „fertig“. Bei „Fehler“ oder fehlgeschlagenen Abschnitten: Meldung lesen, Ursache beheben (mit Test), „Erneut versuchen“.

- [ ] **Step 3: Stichproben**

Pro Foliensatz 5 zufällige Karten im Browser lesen: Inhalt korrekt laut Folie, Antwort ausführlich, Englisch, Folienvorschau passt, Diagramm-Karten zeigen das Bild vorne, Lückentexte funktionieren. Auffälligkeiten (z. B. zu knappe Antworten, zu viele Duplikate) → Prompt in `apps/server/src/prompt.ts` anpassen, betroffenen Foliensatz „Neu erzeugen“.

- [ ] **Step 4: Lernen**

„Heute lernen“: 10 Karten durcharbeiten, alle vier Bewertungen und Rückgängig nutzen; Übersicht zeigt „Heute gelernt“ und Serie 1. Prüfungsdatum im Modul eintragen (sobald bekannt) und prüfen, dass „X neue Karten/Tag“ plausibel ist.

- [ ] **Step 5: Abschluss-Commit (falls Prompt/Code angepasst)**

```bash
git add -A
git commit -m "tune: card prompt after UIUX acceptance run"
```
```
