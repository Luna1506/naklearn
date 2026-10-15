import { renderCloze } from './cloze.ts';
import type { Card, Grade, Note, StudyCard } from './types.ts';

export interface StudyCardInput {
  note: Note;
  card: Card;
  moduleName: string;
  deckTitle: string;
  intervals: Record<Grade, string>;
}

function renderSides(kind: Note['kind'], rawFront: string, rawBack: string, ordinal: number): { front: string; back: string } {
  if (kind !== 'cloze') return { front: rawFront, back: rawBack };
  const full = renderCloze(rawFront, ordinal, 'back');
  return { front: renderCloze(rawFront, ordinal, 'front'), back: rawBack.trim() ? `${full}\n\n---\n\n${rawBack}` : full };
}

export function toStudyCard({ note, card, moduleName, deckTitle, intervals }: StudyCardInput): StudyCard {
  const { front, back } = renderSides(note.kind, note.front, note.back, card.ordinal);
  const de = note.frontDe !== null ? renderSides(note.kind, note.frontDe, note.backDe ?? '', card.ordinal) : null;
  return {
    cardId: card.id,
    noteId: note.id,
    deckId: note.deckId,
    kind: note.kind,
    front,
    back,
    frontDe: de?.front ?? null,
    backDe: de?.back ?? null,
    frontImagePage: note.kind === 'diagram' ? note.frontImagePage : null,
    slides: note.slideRefs,
    moduleName,
    deckTitle,
    intervals,
    noteFront: note.front,
    noteBack: note.back,
  };
}
