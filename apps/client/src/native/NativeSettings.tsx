import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';
import type { LocalStore } from '@naklearn/store';
import { useEffect, useState } from 'react';
import { href } from '../router.ts';
import { syncLabel } from './NativeHome.tsx';
import type { SyncController, SyncState } from './controller.ts';
import { parsePairing } from './transport.ts';

export function NativeSettings({ store, sync, state }: { store: LocalStore; sync: SyncController; state: SyncState }) {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    void sync.pairing().then((p) => {
      if (p) {
        setUrl(p.url);
        setToken(p.token);
      }
    });
  }, [sync]);

  async function scan() {
    setMsg(null);
    try {
      const avail = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
      if (!avail.available) {
        setMsg('QR-Scanner wird installiert … bitte gleich nochmal tippen.');
        await BarcodeScanner.installGoogleBarcodeScannerModule();
        return;
      }
      const { barcodes } = await BarcodeScanner.scan();
      const raw = barcodes[0]?.rawValue;
      const p = raw ? parsePairing(raw) : null;
      if (!p) return setMsg('Kein gültiger NAKLearn-QR-Code.');
      setUrl(p.url);
      setToken(p.token);
      await sync.pair(p.url, p.token);
      setMsg('Gekoppelt.');
    } catch (e) {
      setMsg(String((e as Error).message ?? e));
    }
  }

  return (
    <main className="page native">
      <header className="topbar">
        <a href={href('home')}>←</a>
        <h1>Einstellungen</h1>
      </header>
      <p className={`sync-status ${state.phase}`}>{syncLabel(state)}</p>
      <section className="card-form">
        <h2>Mit dem Laptop koppeln</h2>
        <p className="muted small">Am Laptop: Studio → „Handy koppeln“. Tailscale muss auf beiden Geräten laufen.</p>
        <button className="primary full" onClick={scan}>QR-Code scannen</button>
        <label>Server-Adresse <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://laptop.tailXXXX.ts.net:8742" /></label>
        <label>Token <input value={token} onChange={(e) => setToken(e.target.value)} /></label>
        <button
          onClick={async () => {
            if (!/^https?:\/\//.test(url) || !token) return setMsg('Adresse und Token angeben.');
            await sync.pair(url, token);
            setMsg(sync.state.phase === 'error' ? sync.state.message : 'Gekoppelt.');
          }}
        >
          Manuell koppeln
        </button>
        {msg && <p className="info small">{msg}</p>}
      </section>
      <section className="card-form">
        <button className="full" onClick={() => void sync.sync()} disabled={state.phase === 'syncing'}>Jetzt synchronisieren</button>
        <p className="muted small">Geräte-ID: {store.deviceId}</p>
      </section>
    </main>
  );
}
