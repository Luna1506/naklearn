import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
type Exec = (cmd: string, args: string[]) => Promise<{ stdout: string }>;

/** Adresse, unter der das Handy den Server erreicht (Tailscale MagicDNS bevorzugt). */
export async function detectPublicUrl(port: number, env: NodeJS.ProcessEnv, exec: Exec = execFileAsync): Promise<string | null> {
  if (env.NAKLEARN_PUBLIC_URL) return env.NAKLEARN_PUBLIC_URL.replace(/\/+$/, '');
  try {
    const { stdout } = await exec('tailscale', ['status', '--json']);
    const self = JSON.parse(stdout)?.Self;
    const dns = typeof self?.DNSName === 'string' ? self.DNSName.replace(/\.$/, '') : '';
    if (dns) return `http://${dns}:${port}`;
    const ip = Array.isArray(self?.TailscaleIPs) ? self.TailscaleIPs.find((x: string) => x.includes('.')) : undefined;
    return ip ? `http://${ip}:${port}` : null;
  } catch {
    return null;
  }
}

export function pairingPayload(url: string, token: string): string {
  return JSON.stringify({ v: 1, url, token });
}
