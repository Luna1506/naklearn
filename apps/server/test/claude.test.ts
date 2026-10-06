import { chmodSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { classifyError, createClaudeRunner, parseClaudeOutput } from '../src/claude.ts';

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));

beforeAll(() => chmodSync(FAKE, 0o755));
afterEach(() => {
  delete process.env.FAKE_CLAUDE_MODE;
  delete process.env.FAKE_CLAUDE_LOG;
});

async function call(mode: string) {
  const dir = await mkdtemp(path.join(tmpdir(), 'kartei-claude-'));
  process.env.FAKE_CLAUDE_MODE = mode;
  process.env.FAKE_CLAUDE_LOG = path.join(dir, 'log.jsonl');
  const run = createClaudeRunner({ claudePath: FAKE, model: 'sonnet' });
  const res = await run({ prompt: 'PROMPT-TEXT', jsonSchema: { type: 'object' }, addDirs: ['/slides/x'], cwd: dir });
  const log = JSON.parse(readFileSync(process.env.FAKE_CLAUDE_LOG, 'utf8').trim().split('\n')[0]!);
  return { res, log };
}

describe('createClaudeRunner', () => {
  it('liest structured_output und übergibt Prompt per stdin', async () => {
    const { res, log } = await call('ok');
    expect(res).toEqual({ ok: true, output: { notes: [expect.objectContaining({ front: 'Q' })] } });
    expect(log.stdin).toBe('PROMPT-TEXT');
    expect(log.argv).toEqual(expect.arrayContaining(['-p', '--output-format', 'json', '--json-schema', '--add-dir', '/slides/x', '--model', 'sonnet']));
    expect(log.argv[log.argv.indexOf('--tools') + 1]).toBe('Read');
  });
  it('akzeptiert einen ```json-Block als Fallback', async () => {
    expect((await call('fenced')).res).toEqual({ ok: true, output: { notes: [] } });
  });
  it('meldet ungültiges JSON', async () => {
    expect((await call('invalid')).res).toMatchObject({ ok: false, kind: 'invalid' });
  });
  it('erkennt fehlenden Login', async () => {
    expect((await call('auth')).res).toMatchObject({ ok: false, kind: 'auth' });
  });
  it('erkennt Rate-Limits', async () => {
    expect((await call('ratelimit')).res).toMatchObject({ ok: false, kind: 'rate_limit' });
  });
  it('meldet Abstürze als failed', async () => {
    expect((await call('crash')).res).toMatchObject({ ok: false, kind: 'failed' });
  });
  it('meldet fehlendes Programm', async () => {
    const run = createClaudeRunner({ claudePath: '/nonexistent/claude', model: null });
    expect(await run({ prompt: 'x', jsonSchema: {}, addDirs: [], cwd: tmpdir() })).toMatchObject({ ok: false, kind: 'failed' });
  });
});

describe('classifyError / parseClaudeOutput', () => {
  it('klassifiziert typische Meldungen', () => {
    expect(classifyError('Invalid API key · Please run /login')).toBe('auth');
    expect(classifyError('API Error: 529 overloaded')).toBe('rate_limit');
    expect(classifyError('irgendwas')).toBe('failed');
  });
  it('behandelt leere Ausgabe', () => {
    expect(parseClaudeOutput('')).toMatchObject({ ok: false });
  });
});
