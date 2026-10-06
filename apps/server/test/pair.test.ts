import { describe, expect, it } from 'vitest';
import { detectPublicUrl, pairingPayload } from '../src/pair.ts';

const tsJson = JSON.stringify({ Self: { DNSName: 'nixos.tail1234.ts.net.', TailscaleIPs: ['100.101.102.103', 'fd7a::1'] } });

describe('detectPublicUrl', () => {
  it('bevorzugt NAKLEARN_PUBLIC_URL', async () => {
    expect(await detectPublicUrl(8742, { NAKLEARN_PUBLIC_URL: 'http://x:1/' }, async () => ({ stdout: tsJson }))).toBe('http://x:1');
  });
  it('nutzt den MagicDNS-Namen aus tailscale status', async () => {
    expect(await detectPublicUrl(8742, {}, async () => ({ stdout: tsJson }))).toBe('http://nixos.tail1234.ts.net:8742');
  });
  it('liefert null ohne Tailscale', async () => {
    expect(await detectPublicUrl(8742, {}, async () => { throw new Error('ENOENT'); })).toBeNull();
  });
});

describe('pairingPayload', () => {
  it('enthält Version, URL und Token', () => {
    expect(JSON.parse(pairingPayload('http://h:1', 't'))).toEqual({ v: 1, url: 'http://h:1', token: 't' });
  });
});
