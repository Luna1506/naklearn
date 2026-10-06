import { describe, expect, it } from 'vitest';
import { toCard, toDeck, toModule, toNote, toRevlog, toSlideRow } from '../src/rows.ts';

describe('Zeilen-Mapper', () => {
  it('wandelt snake_case-Zeilen in Domänenobjekte', () => {
    expect(toModule({ id: 'm', name: 'M', language: 'en', exam_date: null, new_per_day: 20, deleted: 0, updated_at: 5 }))
      .toEqual({ id: 'm', name: 'M', language: 'en', examDate: null, newPerDay: 20, deleted: false, updatedAt: 5 });
    expect(toNote({ id: 'n', deck_id: 'd', kind: 'qa', front: 'F', back: 'B', slide_refs: '[1,2]', front_image_page: null, tags: '["t"]', source: 'chunk', position: 3, deleted: 1, updated_at: 9 }))
      .toMatchObject({ slideRefs: [1, 2], tags: ['t'], deleted: true, frontImagePage: null });
    expect(toCard({ id: 'c', note_id: 'n', ordinal: 2, suspended: 1, deleted: 0, updated_at: 1 })).toEqual({ id: 'c', noteId: 'n', ordinal: 2, suspended: true, deleted: false, updatedAt: 1 });
    expect(toRevlog({ id: 'r', card_id: 'c', rating: 3, reviewed_at: 7, duration_ms: 100, device_id: 'x', revokes: null }).revokes).toBeNull();
    expect(toSlideRow({ deck_id: 'd', page: 4, image: '4.jpg', text: 'lang' })).toEqual({ deckId: 'd', page: 4, image: '4.jpg' });
    expect(toDeck({ id: 'd', module_id: 'm', title: 'T', pdf_sha256: 's', page_count: 3, status: 'ready', error: null, summary: '## S', position: 1, deleted: 0, updated_at: 2 }))
      .toMatchObject({ summary: '## S', pageCount: 3, deleted: false });
  });
});
