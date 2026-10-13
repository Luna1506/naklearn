import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, rotateToken } from '../src/config.ts';

const env = (extra: Record<string, string> = {}) => ({
  NAKLEARN_DATA_DIR: mkdtempSync(path.join(tmpdir(), 'naklearn-cfg-')),
  NAKLEARN_PASSWORD: 'pw',
  ...extra,
});

describe('loadConfig', () => {
  it('verweigert den Start ohne Passwort', () => {
    expect(() => loadConfig({ ...env(), NAKLEARN_PASSWORD: '' })).toThrow(/NAKLEARN_PASSWORD/);
    const { NAKLEARN_PASSWORD: _, ...noPw } = env();
    expect(() => loadConfig(noPw)).toThrow(/NAKLEARN_PASSWORD/);
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

describe('rotateToken', () => {
  it('erzeugt ein neues, gespeichertes Token und lässt das Sitzungsgeheimnis', () => {
    const e = env();
    const cfg = loadConfig(e);
    const old = cfg.token;
    const secret = cfg.sessionSecret;
    const next = rotateToken(cfg);
    expect(next).not.toBe(old);
    expect(cfg.token).toBe(next);
    const stored = JSON.parse(readFileSync(path.join(cfg.dataDir, 'config.json'), 'utf8'));
    expect(stored.token).toBe(next);
    expect(loadConfig(e)).toMatchObject({ token: next, sessionSecret: secret });
  });
});
