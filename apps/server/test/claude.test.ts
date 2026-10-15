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

async function call(mode: string, opts: { text?: boolean } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'naklearn-claude-'));
  process.env.FAKE_CLAUDE_MODE = mode;
  process.env.FAKE_CLAUDE_LOG = path.join(dir, 'log.jsonl');
  const run = createClaudeRunner({ claudePath: FAKE });
  const schema = opts.text ? {} : { jsonSchema: { type: 'object' } };
  const res = await run({ prompt: 'PROMPT-TEXT', ...schema, addDirs: ['/slides/x'], cwd: dir, model: 'sonnet' });
  const log = JSON.parse(readFileSync(process.env.FAKE_CLAUDE_LOG, 'utf8').trim().split('\n')[0]!);
  return { res, log };
}

describe('createClaudeRunner', () => {
  it('liest structured_output und übergibt Prompt per stdin', async () => {
    const { res, log } = await call('ok');
    expect(res).toMatchObject({ ok: true, output: { notes: [expect.objectContaining({ front: 'Q' })] } });
    expect(res.ok && res.usage).toEqual({ model: 'claude-sonnet-5-5', inputTokens: 10, outputTokens: 20, cacheReadTokens: 5, cacheCreationTokens: 100, costUsd: 0.0123 });
    expect(log.stdin).toBe('PROMPT-TEXT');
    expect(log.argv).toEqual(expect.arrayContaining(['-p', '--output-format', 'json', '--json-schema', '--add-dir', '/slides/x', '--model', 'sonnet']));
    expect(log.argv[log.argv.indexOf('--tools') + 1]).toBe('Read');
    expect(log.argv[log.argv.indexOf('--allowedTools') + 1]).toBe('Read(//slides/x/**)');
  });
  it('Textmodus ohne Schema liefert die Antwort als Text', async () => {
    const { res, log } = await call('text', { text: true });
    expect(res).toMatchObject({ ok: true, output: 'Antwort mit **Markdown**' });
    expect(log.argv).not.toContain('--json-schema');
  });
  it('Textmodus meldet Rate-Limits weiterhin', async () => {
    expect((await call('ratelimit', { text: true })).res).toMatchObject({ ok: false, kind: 'rate_limit' });
  });
  it('akzeptiert einen ```json-Block als Fallback', async () => {
    expect((await call('fenced')).res).toMatchObject({ ok: true, output: { notes: [] } });
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
    const run = createClaudeRunner({ claudePath: '/nonexistent/claude' });
    expect(await run({ prompt: 'x', jsonSchema: {}, addDirs: [], cwd: tmpdir() })).toMatchObject({ ok: false, kind: 'failed' });
  });
});

describe('classifyError / parseClaudeOutput', () => {
  it('klassifiziert typische Meldungen', () => {
    expect(classifyError('Invalid API key · Please run /login')).toBe('auth');
    expect(classifyError('API Error: 529 overloaded')).toBe('rate_limit');
    expect(classifyError('irgendwas')).toBe('failed');
  });
  it('lässt --model weg, wenn kein Modell angegeben ist', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'naklearn-claude-'));
    process.env.FAKE_CLAUDE_LOG = path.join(dir, 'log.jsonl');
    await createClaudeRunner({ claudePath: FAKE })({ prompt: 'x', jsonSchema: {}, addDirs: [], cwd: dir });
    const log = JSON.parse(readFileSync(process.env.FAKE_CLAUDE_LOG, 'utf8').trim());
    expect(log.argv).not.toContain('--model');
  });
  it('behandelt leere Ausgabe', () => {
    expect(parseClaudeOutput('')).toMatchObject({ ok: false });
  });
});
