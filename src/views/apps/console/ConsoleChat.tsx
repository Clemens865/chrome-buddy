// ConsoleChat — multi-turn Q&A over the live console stream. Feeds the current
// captured logs as context to the model on every turn, so "why is this
// happening?" / "which do I fix first?" work against what's actually on screen.

import { useState } from 'react';
import type { LogEntry } from '../../../console/capture';
import { askConsole, CONSOLE_QUICK_PROMPTS, type ConsoleChatTurn } from '../../../console/consoleChat';
import { useResolvedModelId } from '../../../llm/modelPref';
import { copyToClipboard } from './shared';

export function ConsoleChat({ logs }: { logs: readonly LogEntry[] }) {
  const [turns, setTurns] = useState<ConsoleChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  const modelId = useResolvedModelId();

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setInput('');
    setErr(undefined);
    const history = turns;
    setTurns((t) => [...t, { role: 'user', content: q }]);
    setBusy(true);
    try {
      const answer = await askConsole(logs, history, q, modelId);
      setTurns((t) => [...t, { role: 'assistant', content: answer }]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Chat failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ci-cchat" data-testid="ci-console-chat">
      <div className="ci-cchat-quick">
        {CONSOLE_QUICK_PROMPTS.map((qp) => (
          <button key={qp.label} type="button" className="console-chip" disabled={busy} onClick={() => void send(qp.prompt)}>
            <span className="console-chip-l">{qp.label}</span>
          </button>
        ))}
      </div>
      {turns.length > 0 && (
        <div className="ci-cchat-msgs">
          {turns.map((t, i) => (
            <div key={i} className={'ci-cchat-msg ci-cchat-' + t.role} data-testid="ci-console-chat-msg">
              <span className="ci-cchat-who">{t.role === 'user' ? 'You' : 'Buddy'}</span>
              <div className="ci-cchat-body">{t.content}</div>
              {t.role === 'assistant' && (
                <button type="button" className="ci-card-copy" onClick={() => void copyToClipboard(t.content)} title="Copy answer">Copy</button>
              )}
            </div>
          ))}
          {busy && <div className="ci-cchat-msg ci-cchat-assistant"><span className="ci-cchat-who">Buddy</span><div className="ci-cchat-body ci-cchat-thinking">Thinking…</div></div>}
        </div>
      )}
      {err && <div className="ci-cchat-err">{err}</div>}
      <div className="ci-cchat-input">
        <input
          type="text"
          className="cb-input"
          placeholder="Ask about the console…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void send(input); }}
          disabled={busy}
          data-testid="ci-console-chat-input"
        />
        <button type="button" className="btn btn-sm btn-primary" onClick={() => void send(input)} disabled={busy || !input.trim()} data-testid="ci-console-chat-send">
          Send
        </button>
      </div>
    </div>
  );
}
