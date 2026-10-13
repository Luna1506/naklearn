import { createContext, useContext } from 'react';
import { api, type Me } from './api.ts';
import { href } from './router.ts';

export const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);

export function TopNav() {
  const me = useMe();
  return (
    <nav className="topnav">
      <a href={href('home')}>Übersicht</a>
      <a href={href('all')}>Alle Module</a>
      {me?.isAdmin && <a href={href('people')}>Personen</a>}
      <span className="spacer" />
      <a href={href('account')}>{me?.name ?? 'Konto'}</a>
      <button className="link" onClick={async () => { await api.logout(); location.hash = '#/'; location.reload(); }}>Abmelden</button>
    </nav>
  );
}
