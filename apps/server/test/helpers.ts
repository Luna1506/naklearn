import { CORE_MIGRATIONS } from '@naklearn/core';
import { DatabaseSync } from 'node:sqlite';
import { migrate, migrateServer, type Db } from '../src/db.ts';

export function memDb(): Db {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db, CORE_MIGRATIONS);
  migrateServer(db);
  return db;
}

/** Legt eine Person direkt an (ohne scrypt, für schnelle Tests). */
export function addUser(db: Db, id = 'u1', name = id, isAdmin = false): string {
  db.prepare('INSERT INTO user (id, name, name_key, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?, 0)')
    .run(id, name, name.toLowerCase(), 'x', isAdmin ? 1 : 0);
  return id;
}
