import { useEffect, useState } from 'react';

export type RouteName = 'home' | 'module' | 'deck' | 'browse' | 'study' | 'settings' | 'all' | 'invite' | 'account' | 'people';
export interface Route {
  name: RouteName;
  params: Record<string, string>;
}

const FIXED: Record<string, RouteName> = { settings: 'settings', alle: 'all', konto: 'account', personen: 'people' };
const PATH: Partial<Record<RouteName, string>> = { settings: 'settings', all: 'alle', account: 'konto', people: 'personen' };

export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [pathPart, query = ''] = raw.split('?');
  const params: Record<string, string> = Object.fromEntries(new URLSearchParams(query));
  const seg = pathPart!.split('/').filter(Boolean);
  if (seg.length === 0) return { name: 'home', params: {} };
  if ((seg[0] === 'module' || seg[0] === 'deck') && seg[1]) return { name: seg[0], params: { id: seg[1] } };
  if (seg[0] === 'einladung' && seg[1]) return { name: 'invite', params: { token: seg[1] } };
  if (FIXED[seg[0]!]) return { name: FIXED[seg[0]!]!, params: {} };
  if (seg[0] === 'browse' || seg[0] === 'study') return { name: seg[0], params };
  return { name: 'home', params: {} };
}

export function href(name: RouteName, params: Record<string, string | undefined> = {}): string {
  if (name === 'home') return '#/';
  if (name === 'module' || name === 'deck') return `#/${name}/${params.id}`;
  if (name === 'invite') return `#/einladung/${params.token}`;
  if (PATH[name]) return `#/${PATH[name]}`;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, v);
  const s = q.toString();
  return `#/${name}${s ? `?${s}` : ''}`;
}

export function navigate(name: RouteName, params: Record<string, string | undefined> = {}): void {
  window.location.hash = href(name, params);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
