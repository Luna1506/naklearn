// Release der Android-App als GitHub-Release (für Obtainium).
//   node scripts/release.ts [patch|minor|major]   – Version hochzählen, signierte APK bauen, taggen, pushen, Release anlegen
//   node scripts/release.ts key                   – einmalig: Signaturschlüssel unter ~/.config/naklearn anlegen
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Bump = 'patch' | 'minor' | 'major';

function parse(v: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`Ungültige Version: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function nextVersion(current: string, bump: Bump): string {
  const [a, b, c] = parse(current);
  if (bump === 'patch') return `${a}.${b}.${c + 1}`;
  if (bump === 'minor') return `${a}.${b + 1}.0`;
  if (bump === 'major') return `${a + 1}.0.0`;
  throw new Error(`Unbekannter Schritt: ${bump}`);
}

/** Android-versionCode aus der Version (je Stelle bis 99). */
export function versionCode(v: string): number {
  const [a, b, c] = parse(v);
  return a * 10000 + b * 100 + c;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID = path.join(ROOT, 'apps/client/android');
const SIGNING_DIR = path.join(os.homedir(), '.config/naklearn');
const SIGNING = process.env.NAKLEARN_SIGNING ?? path.join(SIGNING_DIR, 'signing.properties');

const run = (cmd: string, args: string[], cwd = ROOT) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const out = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8' }).trim();

function createKey(): void {
  if (existsSync(SIGNING)) throw new Error(`Schlüssel existiert bereits: ${SIGNING}`);
  mkdirSync(SIGNING_DIR, { recursive: true, mode: 0o700 });
  const store = path.join(SIGNING_DIR, 'release.jks');
  const password = randomBytes(24).toString('base64url');
  run('keytool', [
    '-genkeypair', '-keystore', store, '-storetype', 'PKCS12', '-alias', 'naklearn', '-keyalg', 'RSA', '-keysize', '4096',
    '-validity', '36500', '-storepass', password, '-keypass', password, '-dname', 'CN=NAKLearn',
  ]);
  writeFileSync(SIGNING, `storeFile=${store}\nstorePassword=${password}\nkeyAlias=naklearn\nkeyPassword=${password}\n`, { mode: 0o600 });
  console.log(`Schlüssel angelegt: ${store}\nWICHTIG: ${SIGNING_DIR} sichern – ohne diesen Schlüssel lassen sich keine Updates mehr installieren.`);
}

function release(bump: Bump): void {
  if (!existsSync(SIGNING)) throw new Error('Kein Signaturschlüssel – zuerst `npm run release:key`.');
  if (out('git', ['branch', '--show-current']) !== 'main') throw new Error('Releases nur von main.');
  if (out('git', ['status', '--porcelain'])) throw new Error('Arbeitsverzeichnis ist nicht sauber – erst committen.');

  const pkgFile = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
  const version = nextVersion(pkg.version, bump);
  const tag = `v${version}`;
  const lastTag = out('git', ['tag', '--list', 'v*', '--sort=-v:refname']).split('\n')[0] || '';
  const notes = out('git', ['log', '--pretty=- %s', ...(lastTag ? [`${lastTag}..HEAD`] : ['-20'])]) || '- Wartung';

  pkg.version = version;
  writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);

  run('npm', ['run', 'android:sync', '-w', '@naklearn/client']);
  run('./gradlew', ['assembleRelease', '--no-daemon', `-PnaklearnVersionName=${version}`, `-PnaklearnVersionCode=${versionCode(version)}`], ANDROID);
  mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  const apk = path.join(ROOT, 'dist', `naklearn-${tag}.apk`);
  copyFileSync(path.join(ANDROID, 'app/build/outputs/apk/release/app-release.apk'), apk);

  run('git', ['commit', '-am', `release ${tag}`]);
  run('git', ['tag', tag]);
  run('git', ['push', 'origin', 'main', '--tags']);
  run('gh', ['release', 'create', tag, apk, '--title', `NAKLearn ${tag}`, '--notes', notes]);
  console.log(`Fertig: ${tag} – Obtainium findet das Update beim nächsten Check.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2] ?? 'patch';
  if (arg === 'key') createKey();
  else if (arg === 'patch' || arg === 'minor' || arg === 'major') release(arg);
  else throw new Error('Aufruf: node scripts/release.ts [patch|minor|major|key]');
}
