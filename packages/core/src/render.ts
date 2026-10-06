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
