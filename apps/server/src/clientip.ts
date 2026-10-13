import { BlockList, isIP } from 'node:net';

/** Adressbereiche von Cloudflare (https://www.cloudflare.com/ips/, Stand 2026-10-13). */
const CLOUDFLARE_RANGES = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
  '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
  '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
  '2a06:98c0::/29', '2c0f:f248::/32',
];

const cloudflare = new BlockList();
for (const range of CLOUDFLARE_RANGES) {
  const [net, prefix] = range.split('/') as [string, string];
  cloudflare.addSubnet(net, Number(prefix), net.includes(':') ? 'ipv6' : 'ipv4');
}

const unmap = (ip: string) => (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip);

export function isCloudflare(ip: string): boolean {
  const a = unmap(ip);
  const v = isIP(a);
  return v !== 0 && cloudflare.check(a, v === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Echte Client-Adresse: kommt die Anfrage (laut Proxy) von Cloudflare, steht sie in CF-Connecting-IP.
 * Ohne Cloudflare davor wird der Header ignoriert – sonst könnte ihn jeder fälschen.
 */
export function clientIp(proxyIp: string, cfConnectingIp: string | string[] | undefined): string {
  if (typeof cfConnectingIp === 'string' && isIP(cfConnectingIp) && isCloudflare(proxyIp)) return cfConnectingIp;
  return proxyIp;
}
