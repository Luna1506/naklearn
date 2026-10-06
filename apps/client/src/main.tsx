import '@naklearn/ui/study.css';
import './styles.css';
import { StrictMode } from 'react';
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
