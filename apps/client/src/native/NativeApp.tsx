import { App as CapApp } from '@capacitor/app';
import type { LocalStore } from '@naklearn/store';
import { StudyView } from '@naklearn/ui';
import { useEffect, useMemo, useState } from 'react';
import { navigate, useRoute } from '../router.ts';
import { LocalDataSource, type ImageStore, type SyncController, type SyncState } from './controller.ts';
import { NativeHome } from './NativeHome.tsx';
import { NativeModule } from './NativeModule.tsx';
import { NativeSettings } from './NativeSettings.tsx';

export function NativeApp({ store, images, sync }: { store: LocalStore; images: ImageStore; sync: SyncController }) {
  const route = useRoute();
  const [state, setState] = useState<SyncState>(sync.state);
  const [version, setVersion] = useState(0);
  const source = useMemo(() => new LocalDataSource(store, images), [store, images]);

  useEffect(() => sync.subscribe((s) => {
    setState(s);
    if (s.phase === 'idle') setVersion((v) => v + 1);
  }), [sync]);

  useEffect(() => {
    void sync.sync();
    const timer = setInterval(() => void sync.sync(), 5 * 60_000);
    const resume = CapApp.addListener('resume', () => void sync.sync());
    const back = CapApp.addListener('backButton', () => {
      if (window.location.hash && window.location.hash !== '#/') window.history.back();
      else void CapApp.exitApp();
    });
    return () => {
      clearInterval(timer);
      void resume.then((h) => h.remove());
      void back.then((h) => h.remove());
    };
  }, [sync]);

  switch (route.name) {
    case 'module':
      return <NativeModule key={version} store={store} id={route.params.id!} />;
    case 'settings':
      return <NativeSettings store={store} sync={sync} state={state} />;
    case 'study':
      return (
        <StudyView
          source={source}
          scope={{ moduleId: route.params.moduleId, deckId: route.params.deckId }}
          title={route.params.title ?? 'Lernen'}
          onExit={() => {
            void sync.sync();
            if (route.params.moduleId) navigate('module', { id: route.params.moduleId });
            else navigate('home');
          }}
        />
      );
    default:
      return <NativeHome key={version} store={store} sync={sync} state={state} />;
  }
}
