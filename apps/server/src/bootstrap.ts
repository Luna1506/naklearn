import { studyDay } from '@naklearn/core';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { AccountError, addDevice, createUser } from './accounts.ts';
import { tx, type Db } from './db.ts';

/**
 * Erststart der Mehrbenutzer-Version: legt den Admin an und ordnet ihm alle bisherigen
 * Lernstände, Moduleinstellungen, zurückgestellten Karten und das bisherige Handy-Token zu.
 */
export function bootstrapAccounts(
  db: Db,
  o: { adminName: string; password: string | null; legacyToken: string | null; backupDir: string; now: number },
): { created: boolean; backup: string | null } {
  if (db.prepare('SELECT 1 FROM user LIMIT 1').get()) return { created: false, backup: null };
  if (!o.password) {
    throw new Error(`Noch kein Konto: NAKLEARN_PASSWORD muss beim ersten Start gesetzt sein (Passwort für „${o.adminName}“).`);
  }
  let backup: string | null = null;
  if (db.prepare('SELECT 1 FROM module LIMIT 1').get()) {
    mkdirSync(o.backupDir, { recursive: true });
    backup = path.join(o.backupDir, `pre-multiuser-${studyDay(o.now)}.db`);
    if (!existsSync(backup)) db.prepare('VACUUM INTO ?').run(backup);
  }
  const password = o.password;
  tx(db, () => {
    let admin;
    try {
      admin = createUser(db, { name: o.adminName, password, isAdmin: true, now: o.now });
    } catch (e) {
      // Klare Meldung, welche Umgebungsvariable zu korrigieren ist
      if (!(e instanceof AccountError)) throw e;
      const v = e.message.startsWith('Name') ? 'NAKLEARN_ADMIN' : 'NAKLEARN_PASSWORD';
      throw new Error(`Erststart: ${v} ungültig – ${e.message}`);
    }
    db.prepare('UPDATE revlog SET user_id = ? WHERE user_id IS NULL').run(admin.id);
    db.prepare('INSERT INTO user_card_state (user_id, card_id, json, first_reviewed_at) SELECT ?, card_id, json, first_reviewed_at FROM card_state')
      .run(admin.id);
    db.prepare('INSERT INTO membership (user_id, module_id, exam_date, new_per_day, updated_at) SELECT ?, id, exam_date, new_per_day, ? FROM module WHERE deleted = 0')
      .run(admin.id, o.now);
    db.prepare('INSERT INTO card_flag (user_id, card_id, suspended, updated_at) SELECT ?, id, 1, ? FROM card WHERE suspended = 1')
      .run(admin.id, o.now);
    if (o.legacyToken) addDevice(db, admin.id, 'Bisheriges Handy', o.now, o.legacyToken);
  });
  return { created: true, backup };
}
