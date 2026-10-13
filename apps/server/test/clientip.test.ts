import { describe, expect, it } from 'vitest';
import { clientIp, isCloudflare } from '../src/clientip.ts';

describe('isCloudflare', () => {
  it('erkennt Cloudflare-Adressen (IPv4, IPv6, IPv4-mapped)', () => {
    expect(isCloudflare('104.16.1.1')).toBe(true);
    expect(isCloudflare('172.71.255.255')).toBe(true);
    expect(isCloudflare('2606:4700::1')).toBe(true);
    expect(isCloudflare('::ffff:104.16.1.1')).toBe(true);
    expect(isCloudflare('9.9.9.9')).toBe(false);
    expect(isCloudflare('172.18.0.2')).toBe(false);
    expect(isCloudflare('kein-ip')).toBe(false);
  });
});

describe('clientIp', () => {
  it('nimmt CF-Connecting-IP, wenn die Anfrage von Cloudflare kommt', () => {
    expect(clientIp('104.16.0.5', '9.9.9.9')).toBe('9.9.9.9');
    expect(clientIp('2606:4700::1', '2001:db8::1')).toBe('2001:db8::1');
  });
  it('ignoriert den Header, wenn Cloudflare umgangen wurde', () => {
    expect(clientIp('5.5.5.5', '9.9.9.9')).toBe('5.5.5.5');
  });
  it('bleibt bei der Proxy-Adresse ohne gültigen Header', () => {
    expect(clientIp('104.16.0.5', undefined)).toBe('104.16.0.5');
    expect(clientIp('104.16.0.5', 'quatsch')).toBe('104.16.0.5');
    expect(clientIp('104.16.0.5', ['9.9.9.9', '8.8.8.8'])).toBe('104.16.0.5');
  });
});
