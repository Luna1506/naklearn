import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextVersion, versionCode } from './release.ts';

test('nextVersion zählt patch/minor/major hoch', () => {
  assert.equal(nextVersion('0.1.0', 'patch'), '0.1.1');
  assert.equal(nextVersion('0.1.9', 'minor'), '0.2.0');
  assert.equal(nextVersion('0.9.3', 'major'), '1.0.0');
});

test('versionCode wächst mit jeder Version streng monoton', () => {
  assert.equal(versionCode('0.1.0'), 100);
  assert.equal(versionCode('1.2.3'), 10203);
  assert.ok(versionCode('0.2.0') > versionCode('0.1.99'));
});

test('ungültige Versionen werden abgelehnt', () => {
  assert.throws(() => versionCode('1.2'));
  assert.throws(() => nextVersion('1.2.3', 'huge' as 'patch'));
});
