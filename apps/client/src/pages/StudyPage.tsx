import { StudyView } from '@naklearn/ui';
import { useMemo } from 'react';
import { HttpDataSource } from '../api.ts';
import { navigate } from '../router.ts';

export function StudyPage({ params }: { params: Record<string, string> }) {
  const source = useMemo(() => new HttpDataSource(), []);
  const exit = () => {
    if (params.deckId) navigate('deck', { id: params.deckId });
    else if (params.moduleId) navigate('module', { id: params.moduleId });
    else navigate('home');
  };
  return (
    <StudyView
      source={source}
      scope={{ moduleId: params.moduleId, deckId: params.deckId }}
      title={params.title ?? 'Lernen'}
      onExit={exit}
    />
  );
}
