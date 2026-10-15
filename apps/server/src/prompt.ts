import { CardsOutputSchema, SummaryOutputSchema, type Language } from '@naklearn/core';
import { z } from 'zod';

/** JSON-Schema ohne `$schema`-Angabe: claude validiert nur gegen seinen Standard-Draft. */
function jsonSchemaOf(schema: z.ZodType): object {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

export const summaryJsonSchema: object = jsonSchemaOf(SummaryOutputSchema);
export const cardsJsonSchema: object = jsonSchemaOf(CardsOutputSchema);

/** Folien, die Claude als Bild ansehen darf. */
export interface PromptFigure {
  page: number;
  imagePath: string;
}

export interface SummaryPromptInput {
  language: Language;
  deckTitle: string;
  slides: { page: number; text: string }[];
  figures: PromptFigure[];
}

export interface CardsPromptInput {
  language: Language;
  deckTitle: string;
  summary: string;
  slides: { page: number; text: string }[];
  maxCards: number;
  figures: PromptFigure[];
}

export interface GapsPromptInput {
  language: Language;
  deckTitle: string;
  slides: { page: number; text: string }[];
  existing: { front: string; back: string; slides: number[] }[];
  maxCards: number;
  figures: PromptFigure[];
}

const FIGURE_TEXT_LIMIT = 200;

/** Textarme Folien (vermutlich Abbildungen), höchstens `max`, ohne Titelfolie, in Folienreihenfolge. */
export function pickFigurePages(slides: { page: number; text: string }[], max: number): number[] {
  return slides
    .filter((s) => s.page > 1 && s.text.trim().length < FIGURE_TEXT_LIMIT)
    .sort((a, b) => a.text.trim().length - b.text.trim().length || a.page - b.page)
    .slice(0, max)
    .map((s) => s.page)
    .sort((a, b) => a - b);
}

function languageRule(language: Language): string {
  return language === 'en'
    ? 'Write everything in English, using the exact technical terms from the slides.'
    : 'Write everything in German. The first time an English technical term from the slides appears, give it in parentheses after the German term, e.g. "Gestaltungsrichtlinien (design guidelines)".';
}

function slidesText(slides: { page: number; text: string }[]): string {
  return slides.map((s) => `=== Slide ${s.page} ===\n${s.text || '(no extractable text)'}`).join('\n\n');
}

const CARD_RULES = `- One learning goal per card, one card per concept – no duplicates, no trivia, no details of examples.
- Answers concise but complete: the definition or core statement plus 1–3 key points; a short example only if it really helps. Markdown allowed.
- Kinds:
  - "qa" (default): question on the front, answer on the back.
  - "cloze": only for a key definition or a short list; at most 2 gaps ({{c1::…}}, {{c2::…}}) that hide the key terms; "back" may hold a one-line explanation or be empty.
  - "diagram": only if one of the listed figures is itself the subject AND the answer is not printed on that slide; set "frontImagePage" to that page. Rarely needed.
- "slides": the page numbers the card is based on. "frontImagePage": null unless diagram. "tags": 1–3 short topic tags.`;

const EXAM_SCOPE = `Exam-relevant: core concepts and definitions, models/frameworks and their parts, processes and their steps, key distinctions and comparisons, important principles.
Not exam-relevant: title, agenda and recap-only slides; course logistics; anecdotes and the storytelling of running examples (only the concept they illustrate counts); history and dates; screenshots and their concrete values; tool/UI details.`;

function figureList(figures: PromptFigure[]): string {
  if (figures.length === 0) return '(none)';
  return figures.map((f) => `p. ${f.page}: ${f.imagePath}`).join('\n');
}

export function buildSummaryPrompt(i: SummaryPromptInput): string {
  const text = slidesText(i.slides);
  return `You are condensing lecture slides into a compact, exam-focused study summary.

Lecture: "${i.deckTitle}"
${languageRule(i.language)}

Keep ONLY what a student needs for the exam: core concepts and definitions, models/frameworks and their parts, processes and their steps, key distinctions and comparisons, important principles.
Skip: title, agenda, outline and recap-only slides; course logistics; anecdotes and running-example storytelling (keep only the concept it illustrates); history and dates; screenshots and their concrete values; tool/UI details; anything repeated.

Format: Markdown, "##" sections in lecture order, short bullets. End every bullet with its slide reference, e.g. "(p. 12)" or "(p. 12–14)". Be concise – no filler, no introduction, no conclusion.

Slides that are mostly a figure (open with the Read tool only if you need the figure to understand the content):
${figureList(i.figures)}

Slides (text extracted from the PDF):

${text}

Return JSON matching the given schema: {"summary": "<markdown>"}.`;
}

export function buildCardsPrompt(i: CardsPromptInput): string {
  return `You are writing spaced-repetition flashcards for an exam from lecture slides and their summary.

Lecture: "${i.deckTitle}"
${languageRule(i.language)}

Goal: every exam-relevant piece of content gets exactly one card – nothing important missing, nothing beyond that.
${EXAM_SCOPE}

Hard limits:
- at most ${i.maxCards} cards in total (a cloze note counts once per gap) – this is a ceiling, not a target.
- at most 2 cards per slide.
- Order the notes by importance (most exam-relevant first); anything beyond the limit is dropped from the end.

Rules:
${CARD_RULES}

Summary (what matters, with slide references):

${i.summary}

Slides (full text, check that nothing exam-relevant from them is missing):

${slidesText(i.slides)}

Figures available for diagram cards:
${figureList(i.figures)}

Return JSON matching the given schema: {"notes": [...]}.`;
}

export function buildGapsPrompt(i: GapsPromptInput): string {
  const existing = i.existing.length
    ? i.existing.map((c, n) => `${n + 1}. [p. ${c.slides.join(', ')}] ${c.front.replace(/\s+/g, ' ')} → ${c.back.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n')
    : '(none)';
  return `You are checking a set of exam flashcards for gaps and writing cards ONLY for what is missing.

Lecture: "${i.deckTitle}"
${languageRule(i.language)}

Go through the slides and find exam-relevant content that NO existing card asks for.
${EXAM_SCOPE}

Write new cards only for those gaps. If everything important is covered, return an empty list – that is a good result.
- Never repeat or rephrase something an existing card already covers.
- at most ${i.maxCards} new cards (a cloze note counts once per gap) – a ceiling, not a target.
- Order the notes by importance (most exam-relevant first); anything beyond the limit is dropped from the end.

Rules:
${CARD_RULES}

Existing cards:
${existing}

Slides (full text):

${slidesText(i.slides)}

Slides that are mostly a figure (open with the Read tool only if you need the figure to judge a gap):
${figureList(i.figures)}

Return JSON matching the given schema: {"notes": [...]}.`;
}
