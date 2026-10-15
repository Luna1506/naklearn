import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSource } from './ios-source.ts';

const base = 'https://naklearn.torte-tech.de/ios/';

test('source.json im AltStore/SideStore-Format', () => {
  const s = buildSource({ version: '0.3.1', size: 4242, base, date: '2026-10-15T08:00:00.000Z', notes: '- neu\n' });
  assert.equal(s.name, 'NAKLearn');
  assert.equal(s.identifier, 'de.luna.naklearn.source');
  const [app] = s.apps;
  assert.equal(app!.bundleIdentifier, 'de.luna.naklearn');
  assert.deepEqual(app!.versions[0], {
    version: '0.3.1',
    buildVersion: '301',
    date: '2026-10-15T08:00:00.000Z',
    localizedDescription: '- neu',
    downloadURL: 'https://naklearn.torte-tech.de/ios/NAKLearn.ipa?v=0.3.1',
    size: 4242,
    minOSVersion: '15.0',
  });
  assert.equal(app!.iconURL, 'https://naklearn.torte-tech.de/ios/icon.png');
  assert.deepEqual(app!.appPermissions, { entitlements: [], privacy: {} });
});

test('ungültige Eingaben werden abgelehnt', () => {
  const ok = { version: '0.3.1', size: 1, base, date: 'x' };
  assert.throws(() => buildSource({ ...ok, base: 'http://naklearn.torte-tech.de/ios' }));
  assert.throws(() => buildSource({ ...ok, size: 0 }));
  assert.throws(() => buildSource({ ...ok, version: '0.3' }));
});

test('CLI: build-number und source', () => {
  const script = fileURLToPath(new URL('./ios-source.ts', import.meta.url));
  assert.equal(execFileSync(process.execPath, [script, 'build-number', '1.2.3'], { encoding: 'utf8' }).trim(), '10203');
  const out = execFileSync(process.execPath, [script, 'source', '--version', 'v0.4.0', '--size', '10', '--base', base], { encoding: 'utf8' });
  const s = JSON.parse(out);
  assert.equal(s.apps[0].versions[0].version, '0.4.0');
  assert.equal(s.apps[0].versions[0].buildVersion, '400');
  assert.equal(s.apps[0].versions[0].localizedDescription, 'NAKLearn 0.4.0');
});
