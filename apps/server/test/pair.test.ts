import { describe, expect, it } from 'vitest';
import { pairingPayload } from '../src/pair.ts';

describe('pairingPayload', () => {
  it('enthält Version, URL und Token', () => {
    expect(JSON.parse(pairingPayload('https://h', 't'))).toEqual({ v: 1, url: 'https://h', token: 't' });
  });
});
