import { spawn } from 'node:child_process';

export type ClaudeFailure = 'auth' | 'rate_limit' | 'invalid' | 'failed';
export type ClaudeResult = { ok: true; output: unknown } | { ok: false; kind: ClaudeFailure; message: string };

export interface ClaudeRequest {
  prompt: string;
  jsonSchema: object;
  addDirs: string[];
  cwd: string;
  timeoutMs?: number;
}

export type RunClaude = (req: ClaudeRequest) => Promise<ClaudeResult>;

export function classifyError(text: string): ClaudeFailure {
  if (/not logged in|\/login|authenticat|unauthori[sz]ed|\b401\b|invalid api key|oauth/i.test(text)) return 'auth';
  if (/rate.?limit|usage limit|limit reached|\b429\b|overloaded|\b529\b/i.test(text)) return 'rate_limit';
  return 'failed';
}

export function parseClaudeOutput(stdout: string): ClaudeResult {
  let env: any;
  try {
    env = JSON.parse(stdout.trim());
  } catch {
    return { ok: false, kind: stdout.trim() ? classifyError(stdout) : 'failed', message: stdout.slice(0, 500) || 'leere Ausgabe von claude' };
  }
  if (env.is_error || (typeof env.subtype === 'string' && env.subtype !== 'success')) {
    const msg = String(env.result ?? env.subtype ?? 'Fehler');
    return { ok: false, kind: classifyError(`${msg} ${env.api_error_status ?? ''}`), message: msg.slice(0, 500) };
  }
  if (env.structured_output !== undefined && env.structured_output !== null) return { ok: true, output: env.structured_output };
  const text = String(env.result ?? '');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  try {
    return { ok: true, output: JSON.parse(fenced ? fenced[1]! : text) };
  } catch {
    return { ok: false, kind: 'invalid', message: 'Antwort von claude ist kein JSON' };
  }
}

export function createClaudeRunner(opts: { claudePath: string; model: string | null }): RunClaude {
  return (req) =>
    new Promise((resolve) => {
      const args = [
        '-p', '--output-format', 'json', '--no-session-persistence',
        '--tools', 'Read',
        '--strict-mcp-config', '--setting-sources', '',
        '--json-schema', JSON.stringify(req.jsonSchema),
      ];
      // Lesen nur in den Folienordnern erlauben (`//` = absoluter Pfad in Claude-Code-Regeln).
      for (const d of req.addDirs) args.push('--allowedTools', `Read(/${d.replace(/\/+$/, '')}/**)`, '--add-dir', d);
      if (opts.model) args.push('--model', opts.model);

      const child = spawn(opts.claudePath, args, { cwd: req.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      let done = false;
      const finish = (r: ClaudeResult) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(r);
      };
      const timer = setTimeout(() => child.kill('SIGTERM'), req.timeoutMs ?? 600_000);
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('error', (e) => finish({ ok: false, kind: 'failed', message: `claude nicht startbar: ${e.message}` }));
      child.on('close', (code, signal) => {
        if (signal) return finish({ ok: false, kind: 'failed', message: `claude abgebrochen (${signal}) – Timeout?` });
        const r = parseClaudeOutput(out);
        if (!r.ok && code !== 0 && err.trim() && r.kind === 'failed') {
          return finish({ ok: false, kind: classifyError(err), message: err.slice(0, 500) });
        }
        finish(r);
      });
      child.stdin.on('error', () => {});
      child.stdin.end(req.prompt);
    });
}
