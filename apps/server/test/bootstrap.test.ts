import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { authenticateToken, checkLogin, listUsers } from '../src/accounts.ts';
import { bootstrapAccounts } from '../src/bootstrap.ts';
import * as repo from '../src/repo.ts';
import { memDb } from './helpers.ts';

const NOW = new Date('2026-10-21T10:00:00+09:00').getTime();
const backupDir = () => mkdtempSync(path.join(tmpdir(), 'naklearn-boot-'));

function legacy() {
  const db = memDb();
  const mod = repo.createModule(db, { name: 'Cloud Security', language: 'en', examDate: '2026-10-20', newPerDay: 22 }, 1);
  db.prepare('UPDATE module SET exam_date = ?, new_per_day = ? WHERE id = ?').run('2026-10-20', 22, mod.id);
  const gone = repo.createModule(db, { name: 'Alt', language: 'en' }, 1);
  repo.deleteModule(db, gone.id, 2);
  const deck = repo.createDeck(db, { moduleId: mod.id, title: 'D', pdfSha256: 's' }, 1);
  const { cards } = repo.insertNote(db, { deckId: deck.id, kind: 'qa', front: 'Q', back: 'A', slideRefs: [1], frontImagePage: null, tags: [], source: 'chunk', position: 0 }, 1);
  const cardId = cards[0]!.id;
  db.prepare('UPDATE card SET suspended = 1 WHERE id = ?').run(cardId);
  db.prepare("INSERT INTO revlog (id, card_id, rating, reviewed_at, duration_ms, device_id) VALUES ('r1', ?, 3, 5, 100, 'phone')").run(cardId);
  db.prepare("INSERT INTO card_state (card_id, json, first_reviewed_at) VALUES (?, '{\"reps\":1}', 5)").run(cardId);
  return { db, mod, gone, cardId };
}

describe('bootstrapAccounts', () => {
  it('ordnet alle bestehenden Daten dem Admin zu und sichert vorher', () => {
    const { db, mod, gone, cardId } = legacy();
    const dir = backupDir();
    const r = bootstrapAccounts(db, { adminName: 'luna', password: 'altesPasswort', legacyToken: 'altes-token', backupDir: dir, now: NOW });
    expect(r.created).toBe(true);
    expect(r.backup).toBe(path.join(dir, 'pre-multiuser-2026-10-21.db'));
    expect(existsSync(r.backup!)).toBe(true);
    const admin = checkLogin(db, 'Luna', 'altesPasswort')!;
    expect(admin).toMatchObject({ name: 'luna', isAdmin: true });
    expect(authenticateToken(db, 'altes-token', NOW)?.user.id).toBe(admin.id);
    const ms = db.prepare('SELECT module_id, exam_date, new_per_day FROM membership WHERE user_id = ?').all(admin.id);
    expect(ms).toEqual([{ module_id: mod.id, exam_date: '2026-10-20', new_per_day: 22 }]);
    expect(ms.some((m: any) => m.module_id === gone.id)).toBe(false);
    expect(db.prepare('SELECT suspended FROM card_flag WHERE user_id = ? AND card_id = ?').get(admin.id, cardId)).toEqual({ suspended: 1 });
    expect(db.prepare('SELECT json, first_reviewed_at FROM user_card_state WHERE user_id = ? AND card_id = ?').get(admin.id, cardId))
      .toEqual({ json: '{"reps":1}', first_reviewed_at: 5 });
    expect(db.prepare("SELECT user_id FROM revlog WHERE id = 'r1'").get()).toEqual({ user_id: admin.id });
  });

  it('ein zweiter Start ändert nichts', () => {
    const { db } = legacy();
    const dir = backupDir();
    bootstrapAccounts(db, { adminName: 'luna', password: 'altesPasswort', legacyToken: null, backupDir: dir, now: NOW });
    const again = bootstrapAccounts(db, { adminName: 'jemand', password: null, legacyToken: null, backupDir: dir, now: NOW });
    expect(again).toEqual({ created: false, backup: null });
    expect(listUsers(db)).toHaveLength(1);
  });

  it('frische Installation: Admin ohne Sicherung', () => {
    const db = memDb();
    const r = bootstrapAccounts(db, { adminName: 'luna', password: 'altesPasswort', legacyToken: null, backupDir: backupDir(), now: NOW });
    expect(r).toEqual({ created: true, backup: null });
  });

  it('ohne Konto und ohne Passwort bricht der Start mit klarer Meldung ab', () => {
    const db = memDb();
    expect(() => bootstrapAccounts(db, { adminName: 'luna', password: null, legacyToken: null, backupDir: backupDir(), now: NOW }))
      .toThrow(/NAKLEARN_PASSWORD/);
  });

  it('zu kurzes Passwort: Meldung nennt NAKLEARN_PASSWORD, kein Konto entsteht', () => {
    const { db } = legacy();
    expect(() => bootstrapAccounts(db, { adminName: 'luna', password: 'kurz', legacyToken: null, backupDir: backupDir(), now: NOW }))
      .toThrow(/NAKLEARN_PASSWORD.*8 Zeichen/);
    expect(listUsers(db)).toHaveLength(0);
  });

  it('ungültiger Admin-Name: Meldung nennt NAKLEARN_ADMIN', () => {
    const db = memDb();
    expect(() => bootstrapAccounts(db, { adminName: 'l', password: 'altesPasswort', legacyToken: null, backupDir: backupDir(), now: NOW }))
      .toThrow(/NAKLEARN_ADMIN/);
  });
});
