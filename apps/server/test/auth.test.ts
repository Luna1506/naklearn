import { describe, expect, it } from 'vitest';
import {
  LoginLimiter, SESSION_COOKIE, SESSION_TTL_MS, clearSessionCookie, createSession, passwordMatches, readCookie,
  sessionCookie, verifySession,
} from '../src/auth.ts';

const NOW = 1_800_000_000_000;

describe('passwordMatches', () => {
  it('vergleicht exakt, auch bei unterschiedlicher Länge', () => {
    expect(passwordMatches('geheim', 'geheim')).toBe(true);
    expect(passwordMatches('geheim ', 'geheim')).toBe(false);
    expect(passwordMatches('', 'geheim')).toBe(false);
    expect(passwordMatches('ä€😀', 'ä€😀')).toBe(true);
  });
});

describe('Sitzung', () => {
  it('ist bis zum Ablauf gültig', () => {
    const s = createSession('k', NOW);
    expect(verifySession(s, 'k', NOW)).toBe(true);
    expect(verifySession(s, 'k', NOW + SESSION_TTL_MS - 1)).toBe(true);
    expect(verifySession(s, 'k', NOW + SESSION_TTL_MS)).toBe(false);
  });
  it('lehnt fremdes Geheimnis, Manipulation und Müll ab', () => {
    const s = createSession('k', NOW);
    const [exp, mac] = s.split('.');
    expect(verifySession(s, 'anders', NOW)).toBe(false);
    expect(verifySession(`${Number(exp) + 1000}.${mac}`, 'k', NOW)).toBe(false);
    expect(verifySession(`${exp}.${mac}x`, 'k', NOW)).toBe(false);
    expect(verifySession(undefined, 'k', NOW)).toBe(false);
    expect(verifySession('', 'k', NOW)).toBe(false);
    expect(verifySession('abc', 'k', NOW)).toBe(false);
    expect(verifySession('abc.def', 'k', NOW)).toBe(false);
  });
});

describe('Cookies', () => {
  it('liest einen Wert aus dem Cookie-Header', () => {
    expect(readCookie('a=1; naklearn_session=x.y; b=2', SESSION_COOKIE)).toBe('x.y');
    expect(readCookie('a=1', SESSION_COOKIE)).toBeUndefined();
    expect(readCookie(undefined, SESSION_COOKIE)).toBeUndefined();
  });
  it('setzt HttpOnly/SameSite und Secure nur bei HTTPS', () => {
    const c = sessionCookie('v', true);
    expect(c).toMatch(/^naklearn_session=v; /);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Path=/');
    expect(c).toContain(`Max-Age=${SESSION_TTL_MS / 1000}`);
    expect(c).toContain('Secure');
    expect(sessionCookie('v', false)).not.toContain('Secure');
    expect(clearSessionCookie(false)).toContain('Max-Age=0');
  });
});

describe('LoginLimiter', () => {
  it('sperrt nach 5 Fehlversuchen für 15 Minuten, nur diese IP', () => {
    const l = new LoginLimiter();
    for (let i = 0; i < 4; i++) l.fail('1.1.1.1', NOW);
    expect(l.blocked('1.1.1.1', NOW)).toBe(false);
    l.fail('1.1.1.1', NOW);
    expect(l.blocked('1.1.1.1', NOW)).toBe(true);
    expect(l.blocked('2.2.2.2', NOW)).toBe(false);
    expect(l.blocked('1.1.1.1', NOW + 15 * 60_000 - 1)).toBe(true);
    expect(l.blocked('1.1.1.1', NOW + 15 * 60_000)).toBe(false);
  });
  it('vergisst alte Fehlversuche und setzt bei Erfolg zurück', () => {
    const l = new LoginLimiter();
    for (let i = 0; i < 4; i++) l.fail('1.1.1.1', NOW);
    l.fail('1.1.1.1', NOW + 15 * 60_000); // erster Fehlversuch liegt zu lange zurück → neues Fenster
    expect(l.blocked('1.1.1.1', NOW + 15 * 60_000)).toBe(false);
    for (let i = 0; i < 4; i++) l.fail('3.3.3.3', NOW);
    l.reset('3.3.3.3');
    l.fail('3.3.3.3', NOW);
    expect(l.blocked('3.3.3.3', NOW)).toBe(false);
  });
});
