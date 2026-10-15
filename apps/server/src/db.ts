import { CORE_MIGRATIONS } from '@naklearn/core';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

export function openDb(file: string): Db {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db, CORE_MIGRATIONS);
  migrateServer(db);
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

/** Nur auf dem Server (das Handy teilt nur CORE_MIGRATIONS): Konten und persönlicher Lernstand. */
export const SERVER_MIGRATIONS: string[] = [
  `
  CREATE TABLE user (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    session_epoch INTEGER NOT NULL DEFAULT 0, is_admin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, last_seen_at INTEGER
  );
  CREATE TABLE membership (
    user_id TEXT NOT NULL, module_id TEXT NOT NULL, exam_date TEXT, new_per_day INTEGER NOT NULL DEFAULT 20,
    updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, module_id)
  );
  CREATE INDEX membership_module ON membership(module_id);
  CREATE TABLE card_flag (
    user_id TEXT NOT NULL, card_id TEXT NOT NULL, suspended INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, card_id)
  );
  CREATE TABLE user_card_state (
    user_id TEXT NOT NULL, card_id TEXT NOT NULL, json TEXT NOT NULL, first_reviewed_at INTEGER,
    PRIMARY KEY (user_id, card_id)
  );
  CREATE TABLE device (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    created_at INTEGER NOT NULL, last_seen_at INTEGER
  );
  CREATE TABLE invite (
    token_hash TEXT PRIMARY KEY, user_id TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
  );
  ALTER TABLE revlog ADD COLUMN user_id TEXT;
  CREATE INDEX revlog_user_card ON revlog(user_id, card_id);
  `,
  // Stand der Änderungsfolge beim Anlegen eines Übersetzungs-Jobs (Server-Reihenfolge statt Geräte-Uhrzeit).
  `
  ALTER TABLE job ADD COLUMN seq_at INTEGER;
  `,
];

export function migrateServer(db: Db, migrations: string[] = SERVER_MIGRATIONS): void {
  const r = db.prepare("SELECT value FROM meta WHERE key = 'server_version'").get() as { value: string } | undefined;
  for (let v = r ? Number(r.value) : 0; v < migrations.length; v++) {
    tx(db, () => {
      db.exec(migrations[v]!);
      db.prepare("INSERT INTO meta (key, value) VALUES ('server_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(String(v + 1));
    });
  }
}
