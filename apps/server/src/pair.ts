export function pairingPayload(url: string, token: string): string {
  return JSON.stringify({ v: 1, url, token });
}
