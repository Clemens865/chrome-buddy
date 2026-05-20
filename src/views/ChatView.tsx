// ChatView.tsx — agentic chat. Empty initial state until the agent runtime
// (src/agent) is wired in Wave 4. No mock data.
import { useState, type ReactNode } from 'react';
import { Ic, BuddyMark } from '../ui/icons';

interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  text: string;
}

const SUGGESTIONS = [
  'Summarize this page',
  'Extract the main table to CSV',
  'Research this topic across 3 sites',
  'Draft a reply to this',
];

export function ChatView() {
  const [input, setInput] = useState('');
  const [messages] = useState<ChatMessage[]>([]);

  return (
    <div className="chat">
      <div className="chat-scroller">
        {messages.length === 0 ? (
          <div className="chat-greeting">
            <div className="msg-ava"><BuddyMark size={22} /></div>
            <div>
              <div className="chat-greeting-title">Hi, I&apos;m Buddy.</div>
              <div className="chat-greeting-sub">
                Ask me to do something on this page, or pick a starting point. I&apos;ll show each step and check
                with you before anything consequential.
              </div>
              <div className="chat-suggest" style={{ marginTop: 12 }}>
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="suggest-chip" onClick={() => setInput(s)}>{s}</button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((m) => <Msg key={m.id} role={m.role}>{m.text}</Msg>)
        )}
      </div>
      <ChatComposer input={input} onChange={setInput} />
    </div>
  );
}

function Msg({ role, children }: { role: 'user' | 'agent'; children: ReactNode }) {
  if (role === 'user') {
    return <div className="msg msg-user"><div className="msg-bubble">{children}</div></div>;
  }
  return (
    <div className="msg msg-agent">
      <div className="msg-ava"><BuddyMark size={18} /></div>
      <div className="msg-body">{children}</div>
    </div>
  );
}

function ChatComposer({ input, onChange }: { input: string; onChange: (v: string) => void }) {
  return (
    <div className="composer">
      <div className="composer-bar">
        <button type="button" className="composer-attach" aria-label="Attach"><span className="ic">{Ic.attach}</span></button>
        <textarea className="composer-input" placeholder="Message Buddy…" value={input} onChange={(e) => onChange(e.target.value)} rows={1} />
        <button type="button" className="composer-mic" aria-label="Voice"><span className="ic">{Ic.mic}</span></button>
        <button type="button" className="composer-send" aria-label="Send" disabled={!input.trim()}><span className="ic">{Ic.send}</span></button>
      </div>
      <div className="composer-foot">
        <span className="ctx-chip"><span className="ctx-chip-dot" />This page</span>
        <span className="composer-model">gemini-3.5-flash</span>
      </div>
    </div>
  );
}
