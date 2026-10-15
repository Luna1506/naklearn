#!/usr/bin/env node
// Ersetzt `claude` in Tests. Verhalten über FAKE_CLAUDE_MODE, Protokoll nach FAKE_CLAUDE_LOG.
import { appendFileSync } from 'node:fs';

let stdin = '';
process.stdin.on('data', (d) => (stdin += d));
process.stdin.on('end', () => {
  if (process.env.FAKE_CLAUDE_LOG) {
    appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ argv: process.argv.slice(2), stdin }) + '\n');
  }
  const mode = process.env.FAKE_CLAUDE_MODE ?? 'ok';
  const env = (o) => process.stdout.write(JSON.stringify({ type: 'result', ...o }));
  if (mode === 'ok') {
    env({
      subtype: 'success', is_error: false, result: '',
      structured_output: { notes: [{ kind: 'qa', front: 'Q', back: 'A', slides: [1], frontImagePage: null, tags: [] }] },
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 100 },
      total_cost_usd: 0.0123,
      modelUsage: { 'claude-sonnet-5-5': {} },
    });
  } else if (mode === 'text') {
    env({ subtype: 'success', is_error: false, result: 'Antwort mit **Markdown**', usage: { input_tokens: 1, output_tokens: 2 } });
  } else if (mode === 'fenced') {
    env({ subtype: 'success', is_error: false, result: 'Hier:\n```json\n{"notes":[]}\n```' });
  } else if (mode === 'invalid') {
    env({ subtype: 'success', is_error: false, result: 'Entschuldigung, das kann ich nicht.' });
  } else if (mode === 'auth') {
    env({ subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' });
    process.exitCode = 1;
  } else if (mode === 'ratelimit') {
    env({ subtype: 'success', is_error: true, result: "You've hit your usage limit · resets 5pm", api_error_status: 429 });
    process.exitCode = 1;
  } else if (mode === 'crash') {
    process.stderr.write('Segmentation fault');
    process.exitCode = 139;
  }
});
