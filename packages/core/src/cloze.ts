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
