import '@naklearn/ui/study.css';
import './styles.css';
import { Capacitor } from '@capacitor/core';
import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { onUnauthorized } from './api.ts';
import { LoginPage } from './pages/LoginPage.tsx';
import { createRoot } from 'react-dom/client';
import { BrowserPage } from './pages/BrowserPage.tsx';
import { DeckPage } from './pages/DeckPage.tsx';
import { Home } from './pages/Home.tsx';
import { ModulePage } from './pages/ModulePage.tsx';
import { PairPage } from './pages/PairPage.tsx';
import { StudyPage } from './pages/StudyPage.tsx';
import { useRoute } from './router.ts';

function App() {
  const route = useRoute();
  switch (route.name) {
    case 'module': return <ModulePage id={route.params.id!} />;
    case 'deck': return <DeckPage id={route.params.id!} />;
    case 'browse': return <BrowserPage params={route.params} />;
    case 'study': return <StudyPage params={route.params} />;
    case 'pair': return <PairPage />;
    default: return <Home />;
  }
}

/** Studio im Browser: bei 401 die Login-Seite statt der aktuellen Seite. */
function Studio() {
  const [needLogin, setNeedLogin] = useState(false);
  useEffect(() => onUnauthorized(() => setNeedLogin(true)), []);
  return needLogin ? <LoginPage /> : <App />;
}

/** Im Browser das Studio, in der Android-App die Offline-Oberfläche (Handy-Code nur dort geladen). */
async function boot(): Promise<ReactNode> {
  if (!Capacitor.isNativePlatform()) return <Studio />;
  await import('./native/native.css');
  const [{ openCapAdapter }, { createImageStore }, { LocalStore }, { SyncController }, { NativeApp }] = await Promise.all([
    import('./native/capSqlAdapter.ts'),
    import('./native/images.ts'),
    import('@naklearn/store'),
    import('./native/controller.ts'),
    import('./native/NativeApp.tsx'),
  ]);
  const store = await LocalStore.open(await openCapAdapter());
  const images = await createImageStore();
  const sync = new SyncController(store, images);
  return <NativeApp store={store} images={images} sync={sync} />;
}

const root = createRoot(document.getElementById('root')!);
boot().then(
  (ui) => root.render(<StrictMode>{ui}</StrictMode>),
  (e) => root.render(<pre className="error">Start fehlgeschlagen: {String(e?.message ?? e)}</pre>),
);
