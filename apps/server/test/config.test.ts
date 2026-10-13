import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';

const env = (extra: Record<string, string> = {}) => ({
  NAKLEARN_DATA_DIR: mkdtempSync(path.join(tmpdir(), 'naklearn-cfg-')),
  NAKLEARN_PASSWORD: 'pw',
  ...extra,
});

describe('loadConfig', () => {
  it('Passwort und Admin-Name sind optional (nur für den Erststart)', () => {
    const { NAKLEARN_PASSWORD: _, ...noPw } = env();
    const c = loadConfig(noPw);
    expect(c.password).toBeNull();
    expect(c.adminName).toBe('luna');
    expect(loadConfig(env({ NAKLEARN_ADMIN: 'Mia' })).adminName).toBe('Mia');
  });

  it('behält Token und Sitzungsgeheimnis über Neustarts', () => {
    const e = env();
    const a = loadConfig(e);
    const b = loadConfig(e);
    expect(a.password).toBe('pw');
    expect(a.sessionSecret).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(b.sessionSecret).toBe(a.sessionSecret);
    expect(b.token).toBe(a.token);
    expect(a.sessionSecret).not.toBe(a.token);
  });

  it('liest die öffentliche Adresse ohne Schrägstrich am Ende', () => {
    expect(loadConfig(env({ NAKLEARN_PUBLIC_URL: 'https://naklearn.torte-tech.de/' })).publicUrl).toBe('https://naklearn.torte-tech.de');
    expect(loadConfig(env()).publicUrl).toBeNull();
  });
});
