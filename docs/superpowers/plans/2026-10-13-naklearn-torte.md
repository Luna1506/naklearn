# NAKLearn auf torte – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NAKLearn läuft als Docker-Container auf torte unter `https://naklearn.torte-tech.de` mit Passwort-Login, wird per GitHub Actions über Docker Hub deployt, und die Android-App synchronisiert nur noch dorthin.

**Architecture:** Der Fastify-Server verliert die Loopback-Ausnahme und bekommt Sitzungs-Cookies (HMAC-signiert, zustandslos) neben dem bestehenden Bearer-Token der App. Ein mehrstufiges Dockerfile packt Server, Web-Client, `pdftoppm` und die `claude`-CLI in ein Image; GitHub Actions testet, baut, rauchtestet, pusht `luna1506/naklearn` und führt per SSH `docker compose pull && up -d` auf torte aus. Ein einmaliges Skript zieht die Laptop-Daten ins Docker-Volume um.

**Tech Stack:** Node 24 (TypeScript direkt ausgeführt), Fastify 5, node:sqlite, React 19 + Vite, Capacitor 8, Vitest, Docker/Compose, Nginx Proxy Manager, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-13-naklearn-torte-design.md`

## Global Constraints

- Öffentliche Adresse: `https://naklearn.torte-tech.de`; Port im Container `8742`; Daten im Container unter `/data`.
- Image: `luna1506/naklearn`, Tags `latest` und Commit-SHA; **kein** automatisches Versions-Tagging (Tags `v0.x.y` gehören den APK-Releases).
- Basis-Image `node:24-bookworm-slim`; `@anthropic-ai/claude-code@2.1.296` fest; Prozess läuft als `node` (UID 1000).
- Secrets nur in `~/naklearn/.env` auf torte (`NAKLEARN_PASSWORD`, `CLAUDE_CODE_OAUTH_TOKEN`), nie im Repo oder Image.
- Sitzungs-Cookie `naklearn_session`, 30 Tage, `HttpOnly; SameSite=Lax; Path=/`, `Secure` nur bei HTTPS (laut `X-Forwarded-Proto`).
- Login-Bremse: 5 Fehlversuche pro IP → 15 Minuten `429`.
- Ohne `NAKLEARN_PASSWORD` startet der Server nicht.
- UI-Texte auf Deutsch, Stil wie bestehende Seiten; Code-Kommentare deutsch, knapp.
- Tests: `nix develop -c npm test` (core/server/store mit `TZ=Asia/Seoul`), `nix develop -c npm run typecheck`.
- Nach Änderungen an `package-lock.json`: `npmDepsHash` in `flake.nix` aktualisieren (`nix develop -c prefetch-npm-deps package-lock.json`). Dieser Plan fügt keine npm-Abhängigkeiten hinzu.
- Kartenmengen/Erzeugungslogik nicht anfassen (Luna will wenige Karten und wenig Claude-Verbrauch).

## Review Focus

1. **App-Sync mit `Origin`-Header:** Die Capacitor-WebView kann bei `POST /api/sync` einen `Origin` (z. B. `https://localhost`) mitsenden. Mit gültigem Bearer-Token darf die CSRF-Prüfung nicht greifen → Test in Task 3.
2. **Gefälschtes `X-Forwarded-For`:** Ein Angreifer schickt `X-Forwarded-For: <zufällig>` mit, um die Login-Bremse zu umgehen. Es zählt nur die vom Proxy angehängte (rechteste) Adresse (`trustProxy: 1`) → Test in Task 3.
3. **Folienbilder im Browser:** `<img src="/api/slides/…">` schickt nur das Cookie, kein Token → mit Sitzung 200, ohne 401 → Test in Task 3.
4. **Neustart des Containers:** Sitzungen und App-Token bleiben gültig, weil `sessionSecret` und `token` in `/data/config.json` liegen → Test in Task 2 (zweimal `loadConfig`).
5. **Frisches Docker-Volume gehört root:** Ohne `chown` in Dockerfile bzw. Umzugsskript kann `node` nicht nach `/data` schreiben → Dockerfile legt `/data` als `node:node` an; Rauchtest (Task 6) startet ohne Volume-Vorbereitung und prüft, dass `/data/naklearn.db` entsteht.

---

## Dateiübersicht

| Datei | Aktion | Verantwortung |
|---|---|---|
| `apps/server/src/auth.ts` | neu | Passwortvergleich, Sitzungstoken, Cookie-Helfer, Login-Bremse (rein, ohne Fastify) |
| `apps/server/src/config.ts` | ändern | `password`, `sessionSecret`, `publicUrl`; `rotateToken()` |
| `apps/server/src/pair.ts` | ändern | nur noch `pairingPayload` (Tailscale-Erkennung weg) |
| `apps/server/src/app.ts` | ändern | Auth-Hook, `/api/login`, `/api/logout`, `/api/health`, `/api/pair`, `/api/pair/rotate`, `trustProxy` |
| `apps/server/src/generation.ts` | ändern | Pausenmeldung bei ungültigem Claude-Token |
| `apps/server/package.json` | ändern | Dev-Passwort im `dev`-Skript |
| `apps/server/test/auth.test.ts` | neu | Einheitentests für `auth.ts` |
| `apps/server/test/config.test.ts` | neu | Tests für `loadConfig`/`rotateToken` |
| `apps/server/test/app.test.ts`, `sync-e2e.test.ts`, `pair.test.ts`, `generation.test.ts` | ändern | an neue Auth/Config anpassen |
| `apps/client/src/api.ts` | ändern | `Unauthorized`, `onUnauthorized`, `login`/`logout`/`rotateToken` |
| `apps/client/src/pages/LoginPage.tsx` | neu | Passwort-Formular |
| `apps/client/src/main.tsx` | ändern | Login-Seite bei 401 |
| `apps/client/src/pages/Home.tsx`, `PairPage.tsx`, `styles.css` | ändern | Abmelden, Koppeln-Texte, Token neu erzeugen |
| `apps/client/test/api.test.ts` | ändern | 401-Verhalten |
| `apps/client/src/native/{NativeSettings.tsx,transport.ts,controller.ts}` | ändern | Texte „Server“ statt „Laptop/Tailscale“ |
| `apps/client/android/app/src/main/res/xml/network_security_config.xml` | ändern | `ts.net`-Ausnahme weg |
| `Dockerfile`, `.dockerignore` | neu | Image |
| `deploy/docker-compose.yml`, `deploy/env.example` | neu | Betrieb auf torte |
| `scripts/smoke-image.sh` | neu | Rauchtest des Images (lokal + CI) |
| `.github/workflows/deploy.yml` | neu | CI/CD |
| `scripts/migrate-to-torte.sh` | neu | einmaliger Datenumzug |
| `~/nixos/dotfiles/{flake.nix,flake.lock,home/luna/home.nix,home/luna/modules/naklearn/}` | ändern/löschen | Laptop-Dienst entfernen |

---

### Task 1: `auth.ts` – Passwort, Sitzung, Cookies, Login-Bremse

**Files:**
- Create: `apps/server/src/auth.ts`
- Test: `apps/server/test/auth.test.ts`

**Interfaces:**
- Produces:
  - `SESSION_COOKIE = 'naklearn_session'`, `SESSION_TTL_MS = 30 * 24 * 3600_000`
  - `passwordMatches(given: string, expected: string): boolean`
  - `createSession(secret: string, now: number): string` → `"<ablauf>.<hmac>"`
  - `verifySession(value: string | undefined, secret: string, now: number): boolean`
  - `readCookie(header: string | undefined, name: string): string | undefined`
  - `sessionCookie(value: string, secure: boolean): string` (kompletter `Set-Cookie`-Wert)
  - `clearSessionCookie(secure: boolean): string`
  - `class LoginLimiter { constructor(max = 5, lockMs = 15 * 60_000); blocked(ip: string, now: number): boolean; fail(ip: string, now: number): void; reset(ip: string): void }`

- [ ] **Step 1: Failing tests schreiben**

`apps/server/test/auth.test.ts`:
```ts
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
```

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen**

Run: `cd apps/server && nix develop -c npx vitest run test/auth.test.ts`
Expected: FAIL – `Failed to resolve import "../src/auth.ts"`

- [ ] **Step 3: Implementierung**

`apps/server/src/auth.ts`:
```ts
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'naklearn_session';
export const SESSION_TTL_MS = 30 * 24 * 3600_000;

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/** Zeitkonstanter Vergleich (über SHA-256, damit die Länge nichts verrät). */
export function passwordMatches(given: string, expected: string): boolean {
  return timingSafeEqual(sha(given), sha(expected));
}

const mac = (secret: string, exp: string) => createHmac('sha256', secret).update(exp).digest('base64url');

/** Zustandsloses Sitzungstoken: Ablaufzeit + HMAC darüber. */
export function createSession(secret: string, now: number): string {
  const exp = String(now + SESSION_TTL_MS);
  return `${exp}.${mac(secret, exp)}`;
}

export function verifySession(value: string | undefined, secret: string, now: number): boolean {
  if (!value) return false;
  const [exp, sig, ...rest] = value.split('.');
  if (!exp || !sig || rest.length || !/^\d+$/.test(exp)) return false;
  const want = Buffer.from(mac(secret, exp));
  const got = Buffer.from(sig);
  return got.length === want.length && timingSafeEqual(got, want) && Number(exp) > now;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

const attrs = (maxAge: number, secure: boolean) =>
  `Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

export function sessionCookie(value: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${value}; ${attrs(SESSION_TTL_MS / 1000, secure)}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; ${attrs(0, secure)}`;
}

/** Bremse gegen Passwort-Durchprobieren, im Speicher pro IP. */
export class LoginLimiter {
  private entries = new Map<string, { first: number; count: number; until: number }>();
  constructor(private max = 5, private lockMs = 15 * 60_000) {}

  blocked(ip: string, now: number): boolean {
    const e = this.entries.get(ip);
    if (!e) return false;
    if (e.until > now) return true;
    if (e.until || now - e.first >= this.lockMs) this.entries.delete(ip);
    return false;
  }

  fail(ip: string, now: number): void {
    let e = this.entries.get(ip);
    if (!e || now - e.first >= this.lockMs) {
      e = { first: now, count: 0, until: 0 };
      this.entries.set(ip, e);
    }
    e.count++;
    if (e.count >= this.max) e.until = now + this.lockMs;
  }

  reset(ip: string): void {
    this.entries.delete(ip);
  }
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `cd apps/server && nix develop -c npx vitest run test/auth.test.ts`
Expected: PASS (6 Tests)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/auth.ts apps/server/test/auth.test.ts
git commit -m "feat(server): session tokens, cookie helpers and login limiter"
```

---

### Task 2: Config – Passwort, Sitzungsgeheimnis, öffentliche Adresse, Token erneuern

**Files:**
- Modify: `apps/server/src/config.ts`
- Modify: `apps/server/src/pair.ts`
- Modify: `apps/server/src/generation.ts:220` (Pausenmeldung)
- Modify: `apps/server/package.json` (`dev`-Skript)
- Test: `apps/server/test/config.test.ts` (neu), `apps/server/test/pair.test.ts`, `apps/server/test/generation.test.ts:105`, Config-Literale in `apps/server/test/app.test.ts:15-18` und `apps/server/test/sync-e2e.test.ts:30`

**Interfaces:**
- Produces:
  - `Config` bekommt `password: string`, `sessionSecret: string`, `publicUrl: string | null`
  - `loadConfig(env)` wirft `Error('NAKLEARN_PASSWORD ist nicht gesetzt …')`, wenn das Passwort fehlt oder leer ist
  - `rotateToken(cfg: Config): string` – neues Token, in `config.json` gespeichert, `cfg.token` aktualisiert
  - `pair.ts` exportiert nur noch `pairingPayload(url: string, token: string): string`

- [ ] **Step 1: Failing tests schreiben**

`apps/server/test/config.test.ts`:
```ts
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
```

`apps/server/test/pair.test.ts` komplett ersetzen:
```ts
import { describe, expect, it } from 'vitest';
import { pairingPayload } from '../src/pair.ts';

describe('pairingPayload', () => {
  it('enthält Version, URL und Token', () => {
    expect(JSON.parse(pairingPayload('https://h', 't'))).toEqual({ v: 1, url: 'https://h', token: 't' });
  });
});
```

In `apps/server/test/generation.test.ts:105`:
```ts
    expect(worker.status().pauseReason).toContain('Claude-Token ungültig');
```

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen**

Run: `cd apps/server && nix develop -c npx vitest run test/config.test.ts test/generation.test.ts`
Expected: FAIL – `rotateToken` nicht exportiert / `password` undefined / Pausenmeldung passt nicht

- [ ] **Step 3: Implementierung**

`apps/server/src/config.ts` – Interface und `loadConfig` ersetzen, `rotateToken` ergänzen:
```ts
export interface Config {
  dataDir: string;
  port: number;
  host: string;
  token: string;
  deviceId: string;
  /** Login-Passwort fürs Studio (Pflicht). */
  password: string;
  /** Schlüssel für die Sitzungs-Cookies, bleibt über Neustarts gleich. */
  sessionSecret: string;
  /** Adresse, unter der die App den Server erreicht (für den QR-Code). */
  publicUrl: string | null;
  claudePath: string;
  /** Modell für Zusammenfassungen (günstig), Standard "sonnet". */
  summaryModel: string | null;
  /** Modell für die Kartenerzeugung (Qualität), Standard "opus". */
  cardsModel: string | null;
  webDir: string | null;
}

interface Stored { token?: string; deviceId?: string; sessionSecret?: string }

const configFile = (dataDir: string) => path.join(dataDir, 'config.json');
const secret = () => randomBytes(32).toString('base64url');

function writeStored(dataDir: string, stored: Stored) {
  writeFileSync(configFile(dataDir), JSON.stringify(stored, null, 2), { mode: 0o600 });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const password = env.NAKLEARN_PASSWORD ?? '';
  if (!password) throw new Error('NAKLEARN_PASSWORD ist nicht gesetzt – ohne Passwort startet der Server nicht.');

  const dataDir = path.resolve(env.NAKLEARN_DATA_DIR ?? path.join(os.homedir(), '.local/share/naklearn'));
  for (const d of ['', 'pdfs', 'slides', 'backups']) mkdirSync(path.join(dataDir, d), { recursive: true });

  const file = configFile(dataDir);
  const stored: Stored = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  let changed = false;
  if (!stored.token) { stored.token = secret(); changed = true; }
  if (!stored.deviceId) { stored.deviceId = newId(); changed = true; }
  if (!stored.sessionSecret) { stored.sessionSecret = secret(); changed = true; }
  if (changed) writeStored(dataDir, stored);

  return {
    dataDir,
    port: Number(env.NAKLEARN_PORT ?? 8742),
    host: env.NAKLEARN_HOST ?? '0.0.0.0',
    token: stored.token,
    deviceId: stored.deviceId,
    password,
    sessionSecret: stored.sessionSecret,
    publicUrl: env.NAKLEARN_PUBLIC_URL ? env.NAKLEARN_PUBLIC_URL.replace(/\/+$/, '') : null,
    claudePath: env.NAKLEARN_CLAUDE ?? path.join(os.homedir(), '.local/bin/claude'),
    summaryModel: env.NAKLEARN_SUMMARY_MODEL || 'sonnet',
    cardsModel: env.NAKLEARN_CARDS_MODEL || 'opus',
    webDir: env.NAKLEARN_WEB_DIR ?? defaultWebDir(),
  };
}

/** Neues App-Token; bereits gekoppelte Geräte müssen neu koppeln. */
export function rotateToken(cfg: Config): string {
  const file = configFile(cfg.dataDir);
  const stored: Stored = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  stored.token = secret();
  writeStored(cfg.dataDir, stored);
  cfg.token = stored.token;
  return stored.token;
}
```
(`defaultWebDir` und die Imports bleiben unverändert.)

`apps/server/src/pair.ts` komplett ersetzen:
```ts
export function pairingPayload(url: string, token: string): string {
  return JSON.stringify({ v: 1, url, token });
}
```

`apps/server/src/generation.ts:220` – Meldung ersetzen:
```ts
      pause('Claude-Token ungültig oder abgelaufen – am Laptop `claude setup-token` ausführen, Token in `~/naklearn/.env` auf torte eintragen, `docker compose up -d`, dann „Fortsetzen“.', null);
```

`apps/server/package.json` – `dev`-Skript:
```json
    "dev": "NAKLEARN_DATA_DIR=../../.devdata NAKLEARN_PASSWORD=${NAKLEARN_PASSWORD:-dev} node --watch src/main.ts",
```

Config-Literale in den Tests ergänzen (sonst schlägt `tsc` fehl):
- `apps/server/test/app.test.ts:15-18` →
```ts
  const cfg: Config = {
    dataDir, port: 0, host: '127.0.0.1', token: 'secret', deviceId: 'laptop',
    password: 'pw', sessionSecret: 'session-secret', publicUrl: 'https://naklearn.example',
    claudePath: '/bin/false', summaryModel: null, cardsModel: null, webDir: null,
  };
```
- `apps/server/test/sync-e2e.test.ts:30` →
```ts
  const cfg = { dataDir: '/tmp', port: 0, host: '127.0.0.1', token: 't', deviceId: 'laptop', password: 'pw', sessionSecret: 's', publicUrl: null, claudePath: '', summaryModel: null, cardsModel: null, webDir: null };
```

In `apps/server/src/app.ts` den Import `detectPublicUrl` entfernen und in der Pair-Route vorläufig `const url = cfg.publicUrl;` verwenden (Task 3 baut die Route ohnehin um), damit `tsc` grün bleibt. Im Test „GET /api/pair nur vom Laptop selbst“ (`apps/server/test/app.test.ts`) die erwartete URL von `'http://test.ts.net:8742'` auf `'https://naklearn.example'` ändern.

- [ ] **Step 4: Tests und Typprüfung**

Run: `cd apps/server && nix develop -c npx vitest run test/config.test.ts test/pair.test.ts test/generation.test.ts && cd ../.. && nix develop -c npm run typecheck`
Run zusätzlich: `cd apps/server && nix develop -c npm test`
Expected: alles PASS; `tsc` ohne Fehler.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/config.ts apps/server/src/pair.ts apps/server/src/generation.ts apps/server/src/app.ts apps/server/package.json apps/server/test/config.test.ts apps/server/test/pair.test.ts apps/server/test/generation.test.ts apps/server/test/app.test.ts apps/server/test/sync-e2e.test.ts
git commit -m "feat(server): required password, persistent session secret, public url and token rotation"
```

---

### Task 3: Server-Auth – Hook, Login, Logout, Health, Koppeln

**Files:**
- Modify: `apps/server/src/app.ts` (Kopf mit `LOOPBACK`/`LOCAL_HOSTS`/`hostName`, `buildApp`-Deps, `onRequest`-Hook, Pair-Route)
- Modify: `apps/server/test/app.test.ts`, `apps/server/test/sync-e2e.test.ts`

**Interfaces:**
- Consumes: alles aus Task 1 (`auth.ts`), `Config.password/sessionSecret/publicUrl`, `rotateToken(cfg)` aus Task 2
- Produces (HTTP):
  - `POST /api/login {password}` → `200 {ok:true}` + `Set-Cookie`; `401 {error:'Falsches Passwort'}`; `429 {error:'Zu viele Fehlversuche – bitte 15 Minuten warten.'}`
  - `POST /api/logout` → `200 {ok:true}` + löschendes `Set-Cookie` (ohne Login erreichbar)
  - `GET /api/health` → `200 {ok:true}` (ohne Login)
  - `GET /api/pair` → nur mit Sitzung: `{url, token, payload, qrSvg}`; sonst 401
  - `POST /api/pair/rotate` → nur mit Sitzung: `{ok:true}`; sonst 401
  - alle anderen `/api/*`: Bearer-Token **oder** Sitzung, sonst `401 {error:'unauthorized'}`
  - `buildApp` verliert den Parameter `publicUrl`

- [ ] **Step 1: Tests anpassen und neue Failing-Tests schreiben**

In `apps/server/test/app.test.ts`:

Import ergänzen: `import type { InjectOptions } from 'fastify';` und `import { mkdirSync, writeFileSync } from 'node:fs';` (ist schon da).

`setup()` ersetzen:
```ts
async function setup(opts: { webDir?: boolean } = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'naklearn-app-'));
  for (const d of ['pdfs', 'slides', 'backups']) mkdirSync(path.join(dataDir, d), { recursive: true });
  let webDir: string | null = null;
  if (opts.webDir) {
    webDir = path.join(dataDir, 'web');
    mkdirSync(webDir);
    writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>NAKLearn</title>');
  }
  const cfg: Config = {
    dataDir, port: 0, host: '127.0.0.1', token: 'secret', deviceId: 'laptop',
    password: 'pw', sessionSecret: 'session-secret', publicUrl: 'https://naklearn.example',
    claudePath: '/bin/false', summaryModel: null, cardsModel: null, webDir,
  };
  const db = memDb();
  let woke = 0;
  let t = new Date('2026-10-13T10:00:00+09:00').getTime();
  const worker = { wake: () => void woke++, resume: () => {}, status: () => ({ state: 'idle' as const, pauseReason: null, pausedUntil: null, current: null, queued: 0 }) };
  const raw = buildApp({ db, cfg, worker, now: () => t });
  // Standardmäßig wie die App mit Token; Auth-Tests verwenden `raw`.
  const app = { inject: (o: InjectOptions) => raw.inject({ ...o, headers: { authorization: 'Bearer secret', ...o.headers } }) };
  return { app, raw, db, cfg, woke: () => woke, advance: (ms: number) => void (t += ms) };
}

/** Meldet sich an und liefert den Cookie-Header für Folgeanfragen. */
async function login(raw: Awaited<ReturnType<typeof setup>>['raw'], password = 'pw') {
  const r = await raw.inject({ method: 'POST', url: '/api/login', payload: { password } });
  expect(r.statusCode).toBe(200);
  return String(r.headers['set-cookie']).split(';')[0]!;
}
```

Diese vier alten Tests **löschen**: „verlangt außerhalb von Loopback ein Token“, „Loopback mit fremdem Host-Header (DNS-Rebinding) braucht ein Token“, „lehnt schreibende Cross-Origin-Requests ab“, „GET /api/pair nur vom Laptop selbst“.

Neuen Block am Dateiende anfügen:
```ts
describe('Anmeldung', () => {
  it('ohne Token und Sitzung gibt es 401, mit Token 200', async () => {
    const { raw } = await setup();
    expect((await raw.inject({ method: 'GET', url: '/api/overview' })).statusCode).toBe(401);
    expect((await raw.inject({ method: 'GET', url: '/api/overview', headers: { authorization: 'Bearer falsch' } })).statusCode).toBe(401);
    expect((await raw.inject({ method: 'GET', url: '/api/overview', headers: { authorization: 'Bearer secret' } })).statusCode).toBe(200);
    expect((await raw.inject({ method: 'GET', url: '/api/gibtsnicht' })).statusCode).toBe(401);
  });

  it('Login setzt ein Cookie, das bis zum Ablauf gilt', async () => {
    const { raw, advance } = await setup();
    const cookie = await login(raw);
    expect((await raw.inject({ method: 'GET', url: '/api/overview', headers: { cookie } })).statusCode).toBe(200);
    advance(30 * 24 * 3600_000);
    expect((await raw.inject({ method: 'GET', url: '/api/overview', headers: { cookie } })).statusCode).toBe(401);
  });

  it('manipuliertes Cookie gilt nicht', async () => {
    const { raw } = await setup();
    const cookie = await login(raw);
    const [name, value] = cookie.split('=');
    const [exp, mac] = value!.split('.');
    const forged = `${name}=${Number(exp) + 86_400_000}.${mac}`;
    expect((await raw.inject({ method: 'GET', url: '/api/overview', headers: { cookie: forged } })).statusCode).toBe(401);
  });

  it('Secure nur hinter HTTPS-Proxy', async () => {
    const { raw } = await setup();
    const plain = await raw.inject({ method: 'POST', url: '/api/login', payload: { password: 'pw' } });
    expect(String(plain.headers['set-cookie'])).not.toContain('Secure');
    const https = await raw.inject({ method: 'POST', url: '/api/login', payload: { password: 'pw' }, headers: { 'x-forwarded-proto': 'https' } });
    expect(String(https.headers['set-cookie'])).toContain('Secure');
  });

  it('falsches Passwort 401, nach 5 Fehlversuchen 429 – auch mit richtigem Passwort, andere IP frei', async () => {
    const { raw, advance } = await setup();
    const from = (ip: string, password: string) =>
      raw.inject({ method: 'POST', url: '/api/login', payload: { password }, remoteAddress: '172.18.0.2', headers: { 'x-forwarded-for': ip } });
    for (let i = 0; i < 5; i++) expect((await from('9.9.9.9', 'falsch')).statusCode).toBe(401);
    expect((await from('9.9.9.9', 'pw')).statusCode).toBe(429);
    expect((await from('8.8.8.8', 'pw')).statusCode).toBe(200);
    advance(15 * 60_000);
    expect((await from('9.9.9.9', 'pw')).statusCode).toBe(200);
  });

  it('gefälschtes X-Forwarded-For umgeht die Sperre nicht', async () => {
    const { raw } = await setup();
    const from = (xff: string, password: string) =>
      raw.inject({ method: 'POST', url: '/api/login', payload: { password }, remoteAddress: '172.18.0.2', headers: { 'x-forwarded-for': xff } });
    for (let i = 0; i < 5; i++) await from(`10.0.0.${i}, 9.9.9.9`, 'falsch');
    expect((await from('1.2.3.4, 9.9.9.9', 'pw')).statusCode).toBe(429);
  });

  it('Logout löscht das Cookie, auch ohne gültige Sitzung', async () => {
    const { raw } = await setup();
    const r = await raw.inject({ method: 'POST', url: '/api/logout' });
    expect(r.statusCode).toBe(200);
    expect(String(r.headers['set-cookie'])).toContain('Max-Age=0');
  });

  it('Health und Web-Client ohne Login', async () => {
    const { raw } = await setup({ webDir: true });
    expect((await raw.inject({ method: 'GET', url: '/api/health' })).json()).toEqual({ ok: true });
    const page = await raw.inject({ method: 'GET', url: '/' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('NAKLearn');
  });

  it('Folienbilder mit Sitzung (Browser-img), ohne 401', async () => {
    const { raw, db, cfg } = await setup();
    const mod = repo.createModule(db, { name: 'M', language: 'en' });
    const deck = repo.createDeck(db, { moduleId: mod.id, title: 'D', pdfSha256: 's' });
    mkdirSync(path.join(cfg.dataDir, 'slides', deck.id), { recursive: true });
    writeFileSync(path.join(cfg.dataDir, 'slides', deck.id, '1.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
    const url = `/api/slides/${deck.id}/1.jpg`;
    expect((await raw.inject({ method: 'GET', url })).statusCode).toBe(401);
    const cookie = await login(raw);
    expect((await raw.inject({ method: 'GET', url, headers: { cookie } })).statusCode).toBe(200);
  });

  it('CSRF: Sitzung mit fremder Origin wird abgelehnt, App mit Token und Origin nicht', async () => {
    const { raw } = await setup();
    const cookie = await login(raw);
    const evil = await raw.inject({ method: 'POST', url: '/api/worker/resume', headers: { cookie, host: 'naklearn.example', origin: 'https://evil.example' } });
    expect(evil.statusCode).toBe(403);
    const same = await raw.inject({ method: 'POST', url: '/api/worker/resume', headers: { cookie, host: 'naklearn.example', origin: 'https://naklearn.example' } });
    expect(same.statusCode).toBe(200);
    const app = await raw.inject({
      method: 'POST', url: '/api/sync', headers: { authorization: 'Bearer secret', host: 'naklearn.example', origin: 'https://localhost' },
      payload: { deviceId: 'phone', cursor: 0, push: { modules: [], notes: [], cards: [], revlog: [] } },
    });
    expect(app.statusCode).toBe(200);
  });

  it('Koppeln nur mit Sitzung, Adresse aus der Konfiguration', async () => {
    const { raw } = await setup();
    expect((await raw.inject({ method: 'GET', url: '/api/pair', headers: { authorization: 'Bearer secret' } })).statusCode).toBe(401);
    const cookie = await login(raw);
    const r = await raw.inject({ method: 'GET', url: '/api/pair', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ url: 'https://naklearn.example', token: 'secret' });
    expect(JSON.parse(r.json().payload)).toEqual({ v: 1, url: 'https://naklearn.example', token: 'secret' });
    expect(r.json().qrSvg).toContain('<svg');
  });

  it('Token neu erzeugen: nur mit Sitzung, altes Token danach ungültig', async () => {
    const { raw, cfg } = await setup();
    expect((await raw.inject({ method: 'POST', url: '/api/pair/rotate', headers: { authorization: 'Bearer secret' } })).statusCode).toBe(401);
    const cookie = await login(raw);
    expect((await raw.inject({ method: 'POST', url: '/api/pair/rotate', headers: { cookie } })).statusCode).toBe(200);
    expect(cfg.token).not.toBe('secret');
    expect((await raw.inject({ method: 'GET', url: '/api/overview', headers: { authorization: 'Bearer secret' } })).statusCode).toBe(401);
    expect((await raw.inject({ method: 'GET', url: '/api/overview', headers: { authorization: `Bearer ${cfg.token}` } })).statusCode).toBe(200);
  });
});
```

In `apps/server/test/sync-e2e.test.ts`: `buildApp(...)` ohne `publicUrl` aufrufen und im Transport das Token mitsenden:
```ts
  const app = buildApp({ db, cfg, worker, now: () => NOW });
  ...
    const r = await app.inject({ method: 'POST', url: '/api/sync', payload: req, headers: { authorization: 'Bearer t' } });
```

- [ ] **Step 2: Tests laufen lassen, müssen fehlschlagen**

Run: `cd apps/server && nix develop -c npx vitest run test/app.test.ts test/sync-e2e.test.ts`
Expected: FAIL – u. a. `/api/login` 401 statt 200, `/api/health` 401, Pair 403.

- [ ] **Step 3: Implementierung in `apps/server/src/app.ts`**

Kopf: `LOOPBACK`, `LOCAL_HOSTS` und `hostName` löschen; Imports ergänzen/ändern:
```ts
import {
  LoginLimiter, SESSION_COOKIE, clearSessionCookie, createSession, passwordMatches, readCookie, sessionCookie, verifySession,
} from './auth.ts';
import { rotateToken, type Config } from './config.ts';
import { pairingPayload } from './pair.ts';
import type { FastifyRequest } from 'fastify';
```
(die bisherige Zeile `import type { Config } from './config.ts';` entfällt.)

Unter den Zod-Schemata:
```ts
const LoginInput = z.object({ password: z.string().max(1000) });
/** Ohne Anmeldung erreichbar (alles außerhalb von /api ist der Web-Client). */
const PUBLIC_ROUTES = new Set(['/api/login', '/api/logout', '/api/health']);
```

`buildApp`-Signatur ohne `publicUrl`:
```ts
export function buildApp(deps: {
  db: Db;
  cfg: Config;
  worker: Pick<Worker, 'wake' | 'status' | 'resume'>;
  now?: () => number;
}): FastifyInstance {
  const { db, cfg, worker } = deps;
  const now = deps.now ?? Date.now;
  // Genau ein Proxy (Nginx Proxy Manager) davor: req.ip ist dessen angehängte Client-Adresse.
  const app = Fastify({ logger: false, bodyLimit: 16 << 20, trustProxy: 1 });
  const limiter = new LoginLimiter();
  const hasSession = (req: FastifyRequest) => verifySession(readCookie(req.headers.cookie, SESSION_COOKIE), cfg.sessionSecret, now());
  const hasToken = (req: FastifyRequest) => req.headers.authorization === `Bearer ${cfg.token}`;
```

`onRequest`-Hook ersetzen:
```ts
  app.addHook('onRequest', async (req, reply) => {
    const bearer = hasToken(req);
    // Schreibende Browser-Requests von fremden Webseiten (CSRF) ablehnen; die App schickt ein Token, das keine fremde Seite kennt.
    const origin = req.headers.origin;
    if (!bearer && origin && req.method !== 'GET' && req.method !== 'HEAD') {
      let sameOrigin = false;
      try {
        sameOrigin = new URL(origin).host === req.headers.host;
      } catch {}
      if (!sameOrigin) return reply.code(403).send({ error: 'forbidden origin' });
    }
    const route = req.routeOptions.url;
    const isApi = route === undefined || route.startsWith('/api/');
    if (!isApi || PUBLIC_ROUTES.has(route)) return;
    if (bearer || hasSession(req)) return;
    return reply.code(401).send({ error: 'unauthorized' });
  });
```

Nach dem Error-Handler die neuen Routen:
```ts
  // ---- Anmeldung ----
  app.get('/api/health', async () => ({ ok: true }));

  app.post('/api/login', async (req, reply) => {
    const { password } = LoginInput.parse(req.body);
    const t = now();
    if (limiter.blocked(req.ip, t)) return reply.code(429).send({ error: 'Zu viele Fehlversuche – bitte 15 Minuten warten.' });
    if (!passwordMatches(password, cfg.password)) {
      limiter.fail(req.ip, t);
      return reply.code(401).send({ error: 'Falsches Passwort' });
    }
    limiter.reset(req.ip);
    reply.header('set-cookie', sessionCookie(createSession(cfg.sessionSecret, t), req.protocol === 'https'));
    return { ok: true };
  });

  app.post('/api/logout', async (req, reply) => {
    reply.header('set-cookie', clearSessionCookie(req.protocol === 'https'));
    return { ok: true };
  });
```

Pair-Route ersetzen und Rotate ergänzen:
```ts
  // ---- Koppeln (nur im eingeloggten Studio, nicht per App-Token) ----
  app.get('/api/pair', async (req, reply) => {
    if (!hasSession(req)) return reply.code(401).send({ error: 'unauthorized' });
    const url = cfg.publicUrl;
    const payload = url ? pairingPayload(url, cfg.token) : null;
    const qrSvg = payload ? await QRCode.toString(payload, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) : null;
    return { url, token: cfg.token, payload, qrSvg };
  });

  app.post('/api/pair/rotate', async (req, reply) => {
    if (!hasSession(req)) return reply.code(401).send({ error: 'unauthorized' });
    rotateToken(cfg);
    return { ok: true };
  });
```

- [ ] **Step 4: Alle Server-Tests und Typprüfung**

Run: `cd apps/server && nix develop -c npm test && cd ../.. && nix develop -c npm run typecheck`
Expected: alle Tests PASS, `tsc` ohne Fehler.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/app.ts apps/server/test/app.test.ts apps/server/test/sync-e2e.test.ts
git commit -m "feat(server): password login with session cookie, health endpoint, session-only pairing and token rotation"
```

---

### Task 4: Web-Client – Login-Seite, Abmelden, Koppeln-Seite

**Files:**
- Modify: `apps/client/src/api.ts` (`request`, `api`)
- Create: `apps/client/src/pages/LoginPage.tsx`
- Modify: `apps/client/src/main.tsx`
- Modify: `apps/client/src/pages/Home.tsx` (Hero-Bereich)
- Modify: `apps/client/src/pages/PairPage.tsx`
- Modify: `apps/client/src/styles.css`
- Test: `apps/client/test/api.test.ts`

**Interfaces:**
- Consumes: HTTP-Endpunkte aus Task 3
- Produces: `class Unauthorized extends Error`, `onUnauthorized(fn: () => void): () => void`, `api.login(password)`, `api.logout()`, `api.rotateToken()`

Abweichung von der Spec: Der Web-Client hat keine Einstellungsseite – „Abmelden“ steht deshalb auf der Übersicht neben „Handy koppeln“.

- [ ] **Step 1: Failing tests schreiben**

In `apps/client/test/api.test.ts` Import erweitern und Tests anfügen:
```ts
import { HttpDataSource, Unauthorized, api, onUnauthorized } from '../src/api.ts';
```
```ts
describe('Anmeldung', () => {
  it('401 meldet sich bei den Abonnenten und wirft Unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })));
    const seen = vi.fn();
    const off = onUnauthorized(seen);
    await expect(api.overview()).rejects.toBeInstanceOf(Unauthorized);
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    await expect(api.overview()).rejects.toBeInstanceOf(Unauthorized);
    expect(seen).toHaveBeenCalledTimes(1);
  });
  it('falsches Passwort beim Login löst keine Login-Seite aus, sondern zeigt die Meldung', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'Falsches Passwort' }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const seen = vi.fn();
    const off = onUnauthorized(seen);
    await expect(api.login('x')).rejects.toThrow('Falsches Passwort');
    expect(seen).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('/api/login', expect.objectContaining({ method: 'POST', body: JSON.stringify({ password: 'x' }) }));
    off();
  });
});
```

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen**

Run: `cd apps/client && nix develop -c npx vitest run test/api.test.ts`
Expected: FAIL – `Unauthorized`/`onUnauthorized`/`api.login` existieren nicht.

- [ ] **Step 3: Implementierung**

`apps/client/src/api.ts` – `request` ersetzen und Helfer davor:
```ts
/** Nicht (mehr) angemeldet – die Oberfläche zeigt dann die Login-Seite. */
export class Unauthorized extends Error {}
const unauthorizedHandlers = new Set<() => void>();
export function onUnauthorized(fn: () => void): () => void {
  unauthorizedHandlers.add(fn);
  return () => {
    unauthorizedHandlers.delete(fn);
  };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (res.status === 401 && url !== '/api/login') {
    for (const fn of unauthorizedHandlers) fn();
    throw new Unauthorized(body?.error ?? 'Nicht angemeldet');
  }
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}
```
Im `api`-Objekt ergänzen:
```ts
  login: (password: string) => request<{ ok: true }>('/api/login', json('POST', { password })),
  logout: () => request<{ ok: true }>('/api/logout', { method: 'POST' }),
  rotateToken: () => request<{ ok: true }>('/api/pair/rotate', { method: 'POST' }),
```

`apps/client/src/pages/LoginPage.tsx`:
```tsx
import { useState } from 'react';
import { api } from '../api.ts';

export function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="page login">
      <h1>NAKLearn</h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.login(password);
            location.reload();
          } catch (err) {
            setError(String((err as Error).message));
            setBusy(false);
          }
        }}
      >
        <label>
          Passwort
          <input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="primary" disabled={busy || !password}>Anmelden</button>
      </form>
      {error && <p className="error">{error}</p>}
    </main>
  );
}
```

`apps/client/src/main.tsx` – Imports ergänzen (`useEffect, useState` aus `react`; `onUnauthorized` aus `./api.ts`; `LoginPage`) und Hülle um `App`:
```tsx
import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { onUnauthorized } from './api.ts';
import { LoginPage } from './pages/LoginPage.tsx';
```
```tsx
/** Studio im Browser: bei 401 die Login-Seite statt der aktuellen Seite. */
function Studio() {
  const [needLogin, setNeedLogin] = useState(false);
  useEffect(() => onUnauthorized(() => setNeedLogin(true)), []);
  return needLogin ? <LoginPage /> : <App />;
}
```
In `boot()`: `if (!Capacitor.isNativePlatform()) return <Studio />;`

`apps/client/src/pages/Home.tsx` – im `hero`-Abschnitt nach dem Koppeln-Link:
```tsx
        <button className="link" onClick={async () => { await api.logout(); location.reload(); }}>Abmelden</button>
```

`apps/client/src/pages/PairPage.tsx` komplett ersetzen:
```tsx
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.ts';
import { href } from '../router.ts';

export function PairPage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.pair>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const load = useCallback(() => {
    api.pair().then(setData, (e) => setError(String(e.message)));
  }, []);
  useEffect(load, [load]);
  return (
    <main className="page">
      <header className="topbar">
        <a href={href('home')}>← Übersicht</a>
        <h1>Handy koppeln</h1>
      </header>
      {error && <p className="error">{error}</p>}
      {data && !data.url && (
        <p className="warn">
          <code>NAKLEARN_PUBLIC_URL</code> ist auf dem Server nicht gesetzt – ohne Adresse kein QR-Code.
        </p>
      )}
      {data?.qrSvg && <div className="qr" dangerouslySetInnerHTML={{ __html: data.qrSvg }} />}
      {data && (
        <ol className="steps">
          <li>NAKLearn-App installieren (GitHub Releases, z. B. über Obtainium).</li>
          <li>App öffnen → Einstellungen → „QR-Code scannen“.</li>
          <li>
            Oder manuell eintragen: Adresse <code>{data.url ?? '–'}</code>, Token{' '}
            {showToken ? <code className="token">{data.token}</code> : <button onClick={() => setShowToken(true)}>anzeigen</button>}
          </li>
        </ol>
      )}
      {data && (
        <p>
          <button
            className="danger"
            onClick={async () => {
              if (!confirm('Neues Token erzeugen? Bereits gekoppelte Handys müssen danach neu gekoppelt werden.')) return;
              try {
                await api.rotateToken();
                setShowToken(false);
                load();
              } catch (e) {
                setError(String((e as Error).message));
              }
            }}
          >
            Token neu erzeugen
          </button>
        </p>
      )}
    </main>
  );
}
```

`apps/client/src/styles.css` – am Ende:
```css
.login { max-width: 360px; margin-top: 15vh; }
.login form { display: flex; flex-direction: column; gap: 12px; }
.login label { display: flex; flex-direction: column; gap: 4px; }
```

- [ ] **Step 4: Tests, Typprüfung, Build**

Run: `nix develop -c npm test && nix develop -c npm run typecheck && nix develop -c npm run build`
Expected: alles grün, `apps/client/dist/index.html` existiert.

- [ ] **Step 5: Im Browser prüfen**

Run (zwei Terminals bzw. Hintergrund): `nix develop -c npm run dev:server` und `nix develop -c npm run dev:client`, dann `http://localhost:5173` öffnen.
Expected: Login-Seite; falsches Passwort → „Falsches Passwort“; `dev` → Übersicht; „Handy koppeln“ zeigt Hinweis auf fehlende `NAKLEARN_PUBLIC_URL`; „Abmelden“ → wieder Login-Seite.

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/api.ts apps/client/src/pages/LoginPage.tsx apps/client/src/main.tsx apps/client/src/pages/Home.tsx apps/client/src/pages/PairPage.tsx apps/client/src/styles.css apps/client/test/api.test.ts
git commit -m "feat(client): login page, logout and token rotation in the studio"
```

---

### Task 5: Android-App – nur noch HTTPS, Texte „Server“

**Files:**
- Modify: `apps/client/android/app/src/main/res/xml/network_security_config.xml`
- Modify: `apps/client/src/native/NativeSettings.tsx:52-55`
- Modify: `apps/client/src/native/transport.ts:17`
- Modify: `apps/client/src/native/controller.ts:65`

**Interfaces:** keine neuen.

- [ ] **Step 1: Prüfen, ob Tests die alten Texte erwarten**

Run: `grep -rn "Laptop" apps/client/test packages/store/test`
Expected: keine Treffer. (Falls doch: die Erwartung im selben Schritt auf den neuen Text ändern.)

- [ ] **Step 2: Änderungen**

`network_security_config.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <!-- nur für den Emulator (npm run dev auf dem Laptop) -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">10.0.2.2</domain>
    </domain-config>
</network-security-config>
```

`NativeSettings.tsx:52-55`:
```tsx
        <h2>Mit dem Server koppeln</h2>
        <p className="muted small">Im Studio (naklearn.torte-tech.de) → „Handy koppeln“ → QR-Code scannen.</p>
        <button className="primary full" onClick={scan}>QR-Code scannen</button>
        <label>Server-Adresse <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://naklearn.torte-tech.de" /></label>
```

`transport.ts:17`: `'Zeitüberschreitung – Server nicht erreichbar'`

`controller.ts:65`: `'Noch nicht mit dem Server gekoppelt'`

- [ ] **Step 3: Tests und Typprüfung**

Run: `nix develop -c npm test && nix develop -c npm run typecheck`
Expected: grün.

- [ ] **Step 4: Commit**

```bash
git add apps/client/android/app/src/main/res/xml/network_security_config.xml apps/client/src/native/NativeSettings.tsx apps/client/src/native/transport.ts apps/client/src/native/controller.ts
git commit -m "feat(android): https only, texts refer to the server instead of laptop/tailscale"
```
(Die neue APK wird erst in Task 9 veröffentlicht, wenn der Server läuft.)

---

### Task 6: Docker-Image, Compose-Datei, Rauchtest

**Files:**
- Create: `Dockerfile`, `.dockerignore`
- Create: `deploy/docker-compose.yml`, `deploy/env.example`
- Create: `scripts/smoke-image.sh`

**Interfaces:**
- Consumes: `GET /api/health`, `POST /api/login` (Task 3); `loadConfig`-Umgebungsvariablen (Task 2)
- Produces: Image `luna1506/naklearn`; `scripts/smoke-image.sh <image>` (Exit 0 = ok), wird in Task 7 von CI benutzt

- [ ] **Step 1: Rauchtest-Skript schreiben (der „Test“)**

`scripts/smoke-image.sh`:
```bash
#!/usr/bin/env bash
# Rauchtest für das NAKLearn-Image: startet einen Container mit leerem Volume und prüft Grundfunktionen.
#   scripts/smoke-image.sh luna1506/naklearn:latest
set -euo pipefail
IMAGE="${1:?Image angeben}"
NAME="naklearn-smoke-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker volume create "$NAME" >/dev/null
docker run -d --name "$NAME" -e NAKLEARN_PASSWORD=smoke -p 127.0.0.1::8742 -v "$NAME:/data" "$IMAGE" >/dev/null
PORT="$(docker port "$NAME" 8742/tcp | head -1 | sed 's/.*://')"
BASE="http://127.0.0.1:$PORT"

for i in $(seq 1 30); do
  curl -fsS "$BASE/api/health" >/dev/null 2>&1 && break
  [ "$i" = 30 ] && { echo "Server antwortet nicht"; docker logs "$NAME"; exit 1; }
  sleep 1
done

check() { if [ "$2" != "$3" ]; then echo "FEHLER: $1 (erwartet $3, bekommen $2)"; docker logs "$NAME"; exit 1; fi; echo "ok: $1"; }
check "health" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health")" 200
check "web-client" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")" 200
check "api ohne login" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/overview")" 401
check "login falsch" "$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d '{"password":"x"}' "$BASE/api/login")" 401
check "login richtig" "$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d '{"password":"smoke"}' "$BASE/api/login")" 200
docker exec "$NAME" pdftoppm -v >/dev/null 2>&1 && echo "ok: pdftoppm" || { echo "FEHLER: pdftoppm fehlt"; exit 1; }
docker exec "$NAME" claude --version && echo "ok: claude" || { echo "FEHLER: claude fehlt"; exit 1; }
docker exec "$NAME" test -e /data/naklearn.db && echo "ok: /data beschreibbar" || { echo "FEHLER: keine Datenbank in /data"; exit 1; }
echo "Rauchtest bestanden"
```
`chmod +x scripts/smoke-image.sh`

- [ ] **Step 2: Rauchtest laufen lassen, muss fehlschlagen**

Run: `scripts/smoke-image.sh naklearn:dev`
Expected: FAIL – `Unable to find image 'naklearn:dev'`

- [ ] **Step 3: Dockerfile, .dockerignore, Compose**

`Dockerfile`:
```dockerfile
# NAKLearn-Server mit Web-Client, pdftoppm und claude-CLI (siehe docs/superpowers/specs/2026-10-13-naklearn-torte-design.md)
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
COPY packages/store/package.json packages/store/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ARG CLAUDE_CODE_VERSION=2.1.296
RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
 && npm cache clean --force \
 && mkdir -p /data && chown node:node /data
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/apps/client/package.json ./apps/client/package.json
COPY --from=build /app/apps/client/dist ./apps/client/dist
ENV NODE_ENV=production \
    NAKLEARN_DATA_DIR=/data \
    NAKLEARN_PORT=8742 \
    NAKLEARN_HOST=0.0.0.0 \
    NAKLEARN_CLAUDE=claude \
    NAKLEARN_WEB_DIR=/app/apps/client/dist \
    DISABLE_AUTOUPDATER=1 \
    HOME=/home/node
USER node
EXPOSE 8742
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8742/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "apps/server/src/main.ts"]
```

`.dockerignore`:
```
**/node_modules
**/dist
result
.devdata
.git
.github
docs
deploy
apps/client/android
*.apk
```

`deploy/docker-compose.yml`:
```yaml
# Liegt auf torte unter ~/naklearn/docker-compose.yml (Secrets in ~/naklearn/.env, siehe env.example).
services:
  naklearn:
    image: luna1506/naklearn:latest
    container_name: naklearn
    restart: unless-stopped
    env_file: .env
    environment:
      NAKLEARN_PUBLIC_URL: https://naklearn.torte-tech.de
    volumes:
      - naklearn_data:/data
    networks:
      - proxy

volumes:
  naklearn_data:

networks:
  proxy:
    external: true
```

`deploy/env.example`:
```
# ~/naklearn/.env auf torte (chmod 600). Werte ohne Anführungszeichen.
NAKLEARN_PASSWORD=
# am Laptop: claude setup-token
CLAUDE_CODE_OAUTH_TOKEN=
# optional, Standard sonnet/opus
#NAKLEARN_SUMMARY_MODEL=sonnet
#NAKLEARN_CARDS_MODEL=opus
```

- [ ] **Step 4: Image bauen und Rauchtest**

Run: `docker build -t naklearn:dev . && scripts/smoke-image.sh naklearn:dev`
Expected: alle Zeilen `ok: …`, am Ende `Rauchtest bestanden`. Falls der Server im Container wegen fehlender Module nicht startet (`docker logs`), die Ursache beheben (z. B. fehlendes Workspace-Paket im Runtime-Stage kopieren) und erneut laufen lassen.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore deploy/docker-compose.yml deploy/env.example scripts/smoke-image.sh
git commit -m "build: docker image with claude cli and poppler, compose file for torte, smoke test"
```

---

### Task 7: GitHub Actions – testen, bauen, pushen, deployen

**Files:**
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: `scripts/smoke-image.sh` (Task 6); Repo-Secrets `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `SSH_PORT` (werden in Task 9 gesetzt)

- [ ] **Step 1: Workflow schreiben**

`.github/workflows/deploy.yml`:
```yaml
name: Test, Build, Deploy

on:
  push:
    branches: [ "main" ]
  workflow_dispatch: {}

concurrency:
  group: deploy-main
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Node
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - name: pdftoppm für die Tests
        run: sudo apt-get update && sudo apt-get install -y poppler-utils

      - name: Tests
        run: |
          npm ci
          npm test
          npm run typecheck

      - name: Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - name: Image bauen
        uses: docker/build-push-action@v6
        with:
          context: .
          load: true
          tags: |
            luna1506/naklearn:latest
            luna1506/naklearn:${{ github.sha }}

      - name: Rauchtest
        run: scripts/smoke-image.sh luna1506/naklearn:${{ github.sha }}

      - name: Push
        run: |
          docker push luna1506/naklearn:${{ github.sha }}
          docker push luna1506/naklearn:latest

      - name: Deploy auf torte
        uses: appleboy/ssh-action@v1.2.0
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USER }}
          key: ${{ secrets.SSH_KEY }}
          port: ${{ secrets.SSH_PORT }}
          script: |
            set -euo pipefail
            cd ~/naklearn
            docker compose pull
            docker compose up -d --remove-orphans
            docker image prune -f
```

- [ ] **Step 2: Syntax prüfen**

Run: `nix run nixpkgs#actionlint -- .github/workflows/deploy.yml`
Expected: keine Ausgabe (Exit 0).

- [ ] **Step 3: Commit (noch nicht pushen – erst nach Task 9 Schritt 4)**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: test, build, smoke-test, push to docker hub and deploy to torte on main"
```

---

### Task 8: Umzugsskript

**Files:**
- Create: `scripts/migrate-to-torte.sh`

**Interfaces:**
- Consumes: Compose-Projekt `~/naklearn` auf torte (Volume heißt dort `naklearn_naklearn_data`), Image `luna1506/naklearn:latest` liegt auf torte vor; `GET /api/health`

- [ ] **Step 1: Skript schreiben**

`scripts/migrate-to-torte.sh`:
```bash
#!/usr/bin/env bash
# Einmaliger Umzug der Laptop-Daten nach torte (Spec §8). Überschreibt nie eine vorhandene Datenbank.
set -euo pipefail
SRC="${NAKLEARN_DATA_DIR:-$HOME/.local/share/naklearn}"
HOST="${TORTE_HOST:-torte}"
VOLUME=naklearn_naklearn_data
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Karten je Modul als JSON (läuft lokal und im Container mit node:sqlite)
COUNT_JS='const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[1],{readOnly:true});console.log(JSON.stringify(db.prepare("SELECT m.name AS name, COUNT(c.id) AS cards FROM module m LEFT JOIN deck d ON d.module_id=m.id LEFT JOIN note n ON n.deck_id=d.id LEFT JOIN card c ON c.note_id=n.id GROUP BY m.id ORDER BY m.name").all()))'

echo "→ Prüfe torte"
ssh "$HOST" 'test -f ~/naklearn/docker-compose.yml && test -f ~/naklearn/.env' \
  || { echo "~/naklearn/docker-compose.yml oder .env fehlt auf $HOST"; exit 1; }
ssh "$HOST" 'cd ~/naklearn && docker compose create --pull missing >/dev/null'
if ssh "$HOST" "docker run --rm -v $VOLUME:/data busybox test -e /data/naklearn.db"; then
  echo "Auf $HOST liegt schon eine naklearn.db im Volume – Abbruch, nichts überschrieben."
  exit 1
fi

echo "→ Stoppe den Laptop-Dienst"
systemctl --user stop naklearn || true
BEFORE="$(node -e "$COUNT_JS" "$SRC/naklearn.db")"
node -e 'const {DatabaseSync}=require("node:sqlite");new DatabaseSync(process.argv[1]).prepare("VACUUM INTO ?").run(process.argv[2])' "$SRC/naklearn.db" "$STAGE/naklearn.db"

echo "→ Übertrage Daten"
tar -cf - -C "$SRC" config.json slides pdfs backups -C "$STAGE" naklearn.db \
  | ssh "$HOST" "docker run --rm -i -v $VOLUME:/data busybox sh -c 'tar -xf - -C /data && chown -R 1000:1000 /data'"

echo "→ Starte NAKLearn auf torte"
ssh "$HOST" 'cd ~/naklearn && docker compose up -d'
for i in $(seq 1 30); do
  ssh "$HOST" "docker exec naklearn node -e \"fetch('http://127.0.0.1:8742/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))\"" && break
  [ "$i" = 30 ] && { echo "Server auf torte antwortet nicht"; ssh "$HOST" 'docker logs --tail 50 naklearn'; exit 1; }
  sleep 2
done

AFTER="$(ssh "$HOST" "docker exec naklearn node -e '$COUNT_JS' /data/naklearn.db")"
echo "Laptop: $BEFORE"
echo "torte:  $AFTER"
[ "$BEFORE" = "$AFTER" ] && echo "Umzug fertig – Kartenzahlen stimmen." || { echo "Kartenzahlen weichen ab!"; exit 1; }
echo "Hinweis: Laptop-Dienst bleibt gestoppt; Daten unter $SRC bleiben als Sicherung liegen."
```
`chmod +x scripts/migrate-to-torte.sh`

- [ ] **Step 2: Syntax und Zählabfrage lokal prüfen (ohne torte anzufassen)**

Run:
```bash
bash -n scripts/migrate-to-torte.sh && nix run nixpkgs#shellcheck -- scripts/migrate-to-torte.sh scripts/smoke-image.sh
node -e "$(sed -n "s/^COUNT_JS='\(.*\)'$/\1/p" scripts/migrate-to-torte.sh)" ~/.local/share/naklearn/naklearn.db
```
Expected: shellcheck ohne Fehler (Warnungen zu absichtlich lokal expandierten Variablen in `ssh "…"` sind ok); Ausgabe z. B. `[{"name":"Cloud Security","cards":222},{"name":"UI/UX Design","cards":0}]`.

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-to-torte.sh
git commit -m "chore: one-time migration script from laptop to torte"
```

---

### Task 9: Inbetriebnahme auf torte (mit Luna)

Dieser Task ändert den Server torte und Lunas Daten – **jeden Schritt, der torte verändert, vorher kurz mit Luna bestätigen.** Schritte mit „Luna:“ braucht sie selbst (Browser, DNS, Passwörter).

- [ ] **Step 1: Vorbereitungen von Luna**

Luna:
1. DNS: A-Record `naklearn.torte-tech.de → 46.225.100.182` beim Domain-Anbieter.
2. Am Laptop `claude setup-token` ausführen und das Token bereithalten.
3. Ein Login-Passwort für NAKLearn ausdenken.
4. Docker-Hub-Access-Token (Read/Write) unter hub.docker.com → Account Settings → Personal access tokens anlegen.

- [ ] **Step 2: Compose und .env auf torte**

```bash
ssh torte 'mkdir -p ~/naklearn && chmod 700 ~/naklearn'
scp deploy/docker-compose.yml torte:naklearn/docker-compose.yml
scp deploy/env.example torte:naklearn/.env && ssh torte 'chmod 600 ~/naklearn/.env'
```
Luna trägt Passwort und Claude-Token ein: `! ssh -t torte nano ~/naklearn/.env`

- [ ] **Step 3: Image auf torte laden und Daten umziehen**

```bash
docker build -t luna1506/naklearn:latest .
docker save luna1506/naklearn:latest | gzip | ssh torte 'gunzip | docker load'
scripts/migrate-to-torte.sh
```
Expected: `Umzug fertig – Kartenzahlen stimmen.`

- [ ] **Step 4: Nginx Proxy Manager, Secrets, erster CI-Lauf**

Luna (NPM-Oberfläche `http://46.225.100.182:81`): Proxy-Host `naklearn.torte-tech.de` → Scheme `http`, Host `naklearn`, Port `8742`; SSL: Let's Encrypt, „Force SSL“, „HTTP/2“; Advanced: `client_max_body_size 200m;`.

Deploy-Schlüssel (Claude, nach Lunas OK):
```bash
ssh-keygen -t ed25519 -N '' -C naklearn-deploy -f "$SCRATCH/naklearn_deploy"
ssh torte "cat >> ~/.ssh/authorized_keys" < "$SCRATCH/naklearn_deploy.pub"
gh secret set SSH_KEY -R Luna1506/naklearn < "$SCRATCH/naklearn_deploy"
gh secret set SSH_HOST -R Luna1506/naklearn -b 46.225.100.182
gh secret set SSH_USER -R Luna1506/naklearn -b torte
gh secret set SSH_PORT -R Luna1506/naklearn -b 22
gh secret set DOCKERHUB_USERNAME -R Luna1506/naklearn -b luna1506
rm "$SCRATCH/naklearn_deploy"
```
(`$SCRATCH` = Scratchpad-Verzeichnis der Sitzung.)
Luna: `! gh secret set DOCKERHUB_TOKEN -R Luna1506/naklearn`

Dann `git push` und den Lauf beobachten: `gh run watch -R Luna1506/naklearn`
Expected: alle Schritte grün; danach `curl -s https://naklearn.torte-tech.de/api/health` → `{"ok":true}`, `curl -s -o /dev/null -w '%{http_code}' https://naklearn.torte-tech.de/api/overview` → `401`.

- [ ] **Step 5: APK v0.2.0 und Abnahme**

`nix develop -c npm run release minor` (baut, taggt `v0.2.0`, pusht, legt GitHub-Release an; der Push löst auch einen Deploy aus – harmlos).

Abnahme mit Luna:
1. `https://naklearn.torte-tech.de` → Login → Übersicht zeigt Cloud Security mit 222 Karten und denselben Lernständen.
2. Einen zurückgestellten UI/UX-Foliensatz mit „Erneut versuchen“ starten → Zusammenfassung und Karten entstehen (prüft Claude-Token und `pdftoppm` im Container).
3. Obtainium aktualisiert auf v0.2.0 → Studio „Handy koppeln“ → QR scannen → „Gekoppelt“, Folienbilder erscheinen beim Lernen.
4. Flugmodus: 5 Karten lernen, einmal Rückgängig, eine Karte bearbeiten → Flugmodus aus → Sync → Studio zeigt dieselbe Zahl „Heute gelernt“ und die geänderte Karte.

Gefundene Fehler: mit Test im betroffenen Paket beheben, committen, pushen (CI deployt).

---

### Task 10: Laptop aufräumen

**Files:**
- Modify: `~/nixos/dotfiles/flake.nix` (Input `naklearn` entfernen, Zeilen 32-35)
- Modify: `~/nixos/dotfiles/home/luna/home.nix:31` (`./modules/naklearn` entfernen)
- Delete: `~/nixos/dotfiles/home/luna/modules/naklearn/`
- Modify: `~/nixos/dotfiles/flake.lock` (durch `nix flake lock`)
- Staged bereits: `~/nixos/dotfiles/modules/networking.nix` (Tailscale/Firewall entfernt)

- [ ] **Step 1: Änderungen**

```bash
cd ~/nixos/dotfiles
git rm -r home/luna/modules/naklearn
sed -i '\|./modules/naklearn|d' home/luna/home.nix
```
In `flake.nix` den Block entfernen:
```nix
    naklearn = {
      url = "git+file:///home/luna/projects/naklearn";
      inputs.nixpkgs.follows = "nixpkgs";
    };
```
Dann: `nix flake lock` (entfernt den Eintrag aus `flake.lock`).

- [ ] **Step 2: Build prüfen**

Run: `cd ~/nixos/dotfiles && git add -A && nixos-rebuild build --flake .#nixos`
Expected: Build erfolgreich; `grep -c naklearn flake.lock` → `0`.

- [ ] **Step 3: Commit und Übergabe**

```bash
git commit -m "naklearn: runs on torte now; drop laptop service and tailscale"
```
Luna: `rebuild "NAKLearn läuft auf torte"`.
Danach prüfen: `systemctl --user status naklearn` → „could not be found“; `tailscale` nicht mehr vorhanden.

- [ ] **Step 4: Memory aktualisieren**

`~/.claude/projects/-home-luna/memory/naklearn-project.md`: Betrieb (torte, `~/naklearn`, Volume `naklearn_naklearn_data`, Deploy per Push auf `main`, `.env`-Inhalt, Claude-Token-Erneuerung) statt Home-Manager-Dienst beschreiben; Deploy-Hinweis „flake update + rebuild“ entfernen.
