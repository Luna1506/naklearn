import type { SqlAdapter } from '../src/adapter.ts';

export async function seed(db: SqlAdapter, opts: { examDate?: string | null } = {}) {
  await db.run("INSERT INTO module (id, name, language, exam_date, new_per_day, updated_at) VALUES ('m1', 'UIUX', 'en', ?, 20, 1)", [opts.examDate ?? null]);
  await db.run("INSERT INTO deck (id, module_id, title, pdf_sha256, page_count, status, position, updated_at) VALUES ('d1', 'm1', 'Ch1', 's', 2, 'ready', 1, 1)");
  await db.run("INSERT INTO slide (deck_id, page, text, image) VALUES ('d1', 1, '', '1.jpg'), ('d1', 2, '', '2.jpg')");
  await db.run(`INSERT INTO note (id, deck_id, kind, front, back, slide_refs, front_image_page, tags, source, position, updated_at)
    VALUES ('n1', 'd1', 'qa', 'Q1', 'A1', '[1]', NULL, '[]', 'chunk', 1, 1),
           ('n2', 'd1', 'cloze', '{{c1::X}} und {{c2::Y}}', '', '[2]', NULL, '[]', 'chunk', 2, 1)`);
  await db.run("INSERT INTO card (id, note_id, ordinal, updated_at) VALUES ('c1', 'n1', 0, 1), ('c2a', 'n2', 1, 1), ('c2b', 'n2', 2, 1)");
}
