import { ChunkOutputSchema, SynthesisOutputSchema, type Language } from '@naklearn/core';
import { z } from 'zod';

/** JSON-Schema ohne `$schema`-Angabe: claude validiert nur gegen seinen Standard-Draft. */
function jsonSchemaOf(schema: z.ZodType): object {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

export const chunkJsonSchema: object = jsonSchemaOf(ChunkOutputSchema);
export const synthesisJsonSchema: object = jsonSchemaOf(SynthesisOutputSchema);

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
