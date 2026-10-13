import { describe, expect, it } from 'vitest';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../src/password.ts';

describe('Passwort-Hash', () => {
  it('prüft richtig und falsch, Salt macht Hashes verschieden', () => {
    const a = hashPassword('geheim123');
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(verifyPassword('geheim123', a)).toBe(true);
    expect(verifyPassword('geheim124', a)).toBe(false);
    expect(hashPassword('geheim123')).not.toBe(a);
  });
  it('lehnt kaputte Hashes ab, ohne zu werfen', () => {
    expect(verifyPassword('x', '')).toBe(false);
    expect(verifyPassword('x', 'bcrypt$1$2')).toBe(false);
    expect(verifyPassword('naklearn-dummy', DUMMY_HASH)).toBe(true);
  });
});
