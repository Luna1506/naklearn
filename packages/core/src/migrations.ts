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
  `
  ALTER TABLE deck ADD COLUMN summary TEXT;
  ALTER TABLE job ADD COLUMN usage_json TEXT;
  `,
];
