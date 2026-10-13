import { CORE_MIGRATIONS } from '@naklearn/core';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { migrate, migrateServer, SERVER_MIGRATIONS } from '../src/db.ts';

describe('migrateServer', () => {
  it('legt die Server-Tabellen an und ist wiederholbar', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, CORE_MIGRATIONS);
    migrateServer(db);
    migrateServer(db);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    for (const t of ['user', 'membership', 'card_flag', 'user_card_state', 'device', 'invite']) expect(tables).toContain(t);
    const cols = (db.prepare('PRAGMA table_info(revlog)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('user_id');
    const v = db.prepare("SELECT value FROM meta WHERE key = 'server_version'").get() as { value: string };
    expect(Number(v.value)).toBe(SERVER_MIGRATIONS.length);
  });
  it('lässt das Handy-Schema (core) unverändert', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, CORE_MIGRATIONS);
    const before = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'card_state'").get();
    migrateServer(db);
    expect(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'card_state'").get()).toEqual(before);
  });
});
