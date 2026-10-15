import { useState } from 'react';
import { Markdown } from './Markdown.tsx';
import type { ChatMessage, StudyDataSource } from './source.ts';

/** Fragen an Claude zu einer Karte. Der Verlauf lebt nur, solange die Karte offen ist. */
export function CardChat({ source, cardId }: { source: StudyDataSource; cardId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const question = input.trim();
    if (!question || busy) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: question }];
    setMessages(next);
    setInput('');
    setError(null);
    setBusy(true);
    try {
      const answer = await source.ask(cardId, next);
      setMessages([...next, { role: 'assistant', content: answer }]);
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setMessages(messages);
      setInput(question);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card-chat" aria-label="Fragen an Claude">
      {messages.map((m, i) =>
        m.role === 'user'
          ? <p key={i} className="chat-question">{m.content}</p>
          : <Markdown key={i} text={m.content} className="chat-answer" />,
      )}
      {busy && <p className="muted small">Claude denkt nach …</p>}
      {error && <p className="error">{error}</p>}
      <div className="chat-input">
        <textarea
          aria-label="Frage an Claude"
          placeholder="Frage zu dieser Karte … (Enter senden, Umschalt+Enter neue Zeile)"
          rows={2}
          maxLength={2000}
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="primary" onClick={() => void send()} disabled={busy || !input.trim()}>Senden</button>
      </div>
    </section>
  );
}
