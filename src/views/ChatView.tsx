// ChatView.tsx — agentic chat wired to the real AgentRuntime + Gemini.
//
// The user types a task → Gemini plans (via the background SW) → page tools run
// in the SW on the active tab → step traces + HITL confirmation cards render
// inline → final answer. The API key is never touched here; everything routes
// through the background (see src/agent/runner.ts for the security posture).

import { useCallback, useRef, useState } from 'react';
import { Ic, BuddyMark } from '../ui/icons';
import { usePersistedState } from '../sidepanel/usePersistedState';
import { requestPageContext } from '../page/request';
import { persistRun } from '../memory/request';
import { buildRunRecord } from '../memory/buildRecord';
import { DEFAULT_REGISTRY } from '../llm/registry.default';
import {
  runAgentTask,
  runPlainChat,
  reduceTranscript,
  resolveConfirmation,
  resolveIntent,
  buildContextBlock,
  hasProfile,
  userItem,
  agentItem,
  EMPTY_PROFILES,
  PLAIN_CHAT_MODEL,
  type ChatMode,
  type TranscriptItem,
  type Profiles,
  type ProfileKind,
} from '../agent';

const AGENT_MODEL = DEFAULT_REGISTRY.defaultModel ?? 'gemini-2.5-flash';
import type { AgentEvent, ApprovalDecision } from '../agent';

const SUGGESTIONS = [
  'Summarize this page',
  'Extract the main table to CSV',
  'Research this topic across 3 sites',
  'Draft a reply to this',
];

/** A pending HITL gate awaiting the user's Approve/Cancel. */
interface PendingConfirm {
  step: number;
  callId: string;
  resolve: (decision: ApprovalDecision) => void;
}

export function ChatView() {
  const [input, setInput] = useState('');
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [noKey, setNoKey] = useState(false);
  const [mode, setMode] = usePersistedState<ChatMode>('chatMode', 'auto');
  const [attachPage, setAttachPage] = usePersistedState<boolean>('attachPage', true);
  const [profiles] = usePersistedState<Profiles>('userProfiles', EMPTY_PROFILES);
  const [activeProfile] = usePersistedState<ProfileKind>('activeProfile', 'professional');
  const [attachProfile] = usePersistedState<boolean>('attachProfile', false);
  const pendingRef = useRef<PendingConfirm | null>(null);
  const seqRef = useRef(0);

  const submit = useCallback(
    async (text: string) => {
      const prompt = text.trim();
      if (!prompt || busy) return;
      setInput('');
      setNoKey(false);
      setBusy(true);
      const startedAt = Date.now();
      const uid = `user_${seqRef.current++}`;
      setItems((prev) => [...prev, userItem(uid, prompt)]);

      const onEvent = (event: AgentEvent) => {
        setItems((prev) => reduceTranscript(prev, event));
      };

      const onConfirm = (req: {
        runId: string;
        step: number;
        tool: string;
        args: Record<string, unknown>;
        summary: string;
      }): Promise<ApprovalDecision> =>
        // The confirm CARD is already rendered by the reducer (the runtime emits
        // confirmation_required before awaiting this resolver). We just hold the
        // resolver until the user clicks Approve/Cancel on the matching card.
        new Promise<ApprovalDecision>((resolve) => {
          pendingRef.current = { step: req.step, callId: req.summary, resolve };
        });

      try {
        // Auto-route (or honor the forced mode): simple Q&A → cheap tool-less
        // chat; page/action intent → the full agentic loop.
        if (resolveIntent(mode, prompt) === 'chat') {
          // Attach the page content (so chat sees the page without an agentic
          // read_dom round-trip) and/or the user profile, per the toggles.
          const active = profiles[activeProfile];
          const useProfile = attachProfile && hasProfile(active);
          const page = attachPage ? await requestPageContext() : null;
          const context = buildContextBlock(page, useProfile ? active : null, activeProfile);
          const r = await runPlainChat(prompt, { context });
          if (r.outcome === 'no-key') setNoKey(true);
          else if (r.text) {
            setItems((prev) => [...prev, agentItem(`a_${seqRef.current++}`, r.text!)]);
            void persistRun(
              buildRunRecord({ kind: 'chat', task: prompt, answer: r.text, model: PLAIN_CHAT_MODEL, startedAt }),
            );
          }
        } else {
          const result = await runAgentTask(prompt, { onEvent, onConfirm });
          if (result.outcome === 'no-key') setNoKey(true);
          else if (result.state) {
            const sp = result.state.scratchpad;
            void persistRun(
              buildRunRecord({
                kind: 'agent',
                task: prompt,
                answer: result.state.finalAnswer ?? '',
                outcome: result.outcome,
                tools: sp.actions.map((a) => a.toolName),
                provenance: sp.provenance,
                model: AGENT_MODEL,
                startedAt,
              }),
            );
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setItems((prev) => [...prev, { kind: 'error', id: `err_${seqRef.current++}`, text: message }]);
      } finally {
        pendingRef.current = null;
        setBusy(false);
      }
    },
    [busy, mode, attachPage, attachProfile, profiles, activeProfile],
  );

  const decide = useCallback((step: number, callId: string, approved: boolean) => {
    setItems((prev) => resolveConfirmation(prev, step, callId, approved ? 'approved' : 'denied'));
    const pending = pendingRef.current;
    if (pending && pending.step === step) {
      pending.resolve(approved ? { approved: true } : { approved: false });
      pendingRef.current = null;
    }
  }, []);

  const isEmpty = items.length === 0 && !noKey;

  return (
    <div className="chat">
      <div className="chat-scroller">
        {isEmpty ? (
          <Greeting onPick={setInput} />
        ) : (
          <>
            {items.map((it) => (
              <TranscriptRow key={it.id} item={it} onDecide={decide} />
            ))}
            {noKey && <NoKeyNotice />}
          </>
        )}
      </div>
      <ChatComposer
        input={input}
        onChange={setInput}
        onSend={() => void submit(input)}
        busy={busy}
        mode={mode}
        onMode={setMode}
        attachPage={attachPage}
        onAttachPage={() => setAttachPage(!attachPage)}
      />
    </div>
  );
}

function Greeting({ onPick }: { onPick: (v: string) => void }) {
  return (
    <div className="chat-greeting">
      <div className="msg-ava">
        <BuddyMark size={22} />
      </div>
      <div>
        <div className="chat-greeting-title">Hi, I&apos;m Buddy.</div>
        <div className="chat-greeting-sub">
          Ask me to do something on this page, or pick a starting point. I&apos;ll show each step and check
          with you before anything consequential.
        </div>
        <div className="chat-suggest" style={{ marginTop: 12 }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="suggest-chip" onClick={() => onPick(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function NoKeyNotice() {
  return (
    <div className="hitl" role="alert">
      <div className="hitl-hd">
        <span className="hitl-ic">
          <span className="ic">{Ic.warn}</span>
        </span>
        <span className="hitl-title">No API key set</span>
      </div>
      <div className="hitl-foot">
        Add your Gemini API key in Settings to let Buddy plan and act. Your key is stored locally on this
        device and is never sent anywhere but the model provider.
      </div>
    </div>
  );
}

function TranscriptRow({
  item,
  onDecide,
}: {
  item: TranscriptItem;
  onDecide: (step: number, callId: string, approved: boolean) => void;
}) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="msg msg-user">
          <div className="msg-bubble">{item.text}</div>
        </div>
      );

    case 'agent':
      return (
        <div className="msg msg-agent">
          <div className="msg-ava">
            <BuddyMark size={18} />
          </div>
          <div className="msg-body">{item.text}</div>
        </div>
      );

    case 'error':
      return (
        <div className="msg msg-agent msg-subtle">
          <div className="msg-ava">
            <span className="ic">{Ic.warn}</span>
          </div>
          <div className="msg-body">{item.text}</div>
        </div>
      );

    case 'plan':
      return (
        <div className="trace" aria-label="Plan">
          {item.plan.map((p) => (
            <div key={p.index} className="tc-mini tc-mini-inline">
              <span className="tc-mini-name">{p.index}.</span>
              <span className="tc-mini-arg">{p.intent}</span>
            </div>
          ))}
        </div>
      );

    case 'tool':
      return <ToolTrace item={item} />;

    case 'confirm':
      return <ConfirmCard item={item} onDecide={onDecide} />;

    default: {
      const exhaustive: never = item;
      void exhaustive;
      return null;
    }
  }
}

function ToolTrace({ item }: { item: Extract<TranscriptItem, { kind: 'tool' }> }) {
  const statusClass =
    item.status === 'running' ? 'tc-status-running' : 'tc-status-done';
  const argText = summarizeArgs(item.call.arguments);
  return (
    <div className="trace">
      <div className="tc-mini">
        <span className={`tc-status ${statusClass}`} aria-hidden />
        <span className="tc-mini-name">{item.call.name}</span>
        <span className="tc-mini-arg" title={argText}>
          {argText}
        </span>
        {item.status === 'denied' && <span className="tc-meta">denied</span>}
        {item.status === 'done' && item.verdict && <span className="tc-meta">{item.verdict}</span>}
      </div>
    </div>
  );
}

function ConfirmCard({
  item,
  onDecide,
}: {
  item: Extract<TranscriptItem, { kind: 'confirm' }>;
  onDecide: (step: number, callId: string, approved: boolean) => void;
}) {
  const resolved = item.resolution !== undefined;
  const entries = Object.entries(item.call.arguments);
  return (
    <div className="hitl" role="group" aria-label="Confirmation required">
      <div className="hitl-hd">
        <span className="hitl-ic">
          <span className="ic">{Ic.warn}</span>
        </span>
        <span className="hitl-title">Confirm this action</span>
        <span className="hitl-tag">{resolved ? item.resolution : 'review'}</span>
      </div>
      <div className="hitl-body">
        <div className="hitl-tool">
          <span className="hitl-tool-ic">
            <span className="ic">{Ic.sparkle}</span>
          </span>
          <div>
            <div className="hitl-tool-name">{item.call.name}</div>
            <div className="hitl-tool-args">
              {entries.length === 0 ? (
                <div>
                  <span>args</span>
                  <code>(none)</code>
                </div>
              ) : (
                entries.map(([k, v]) => (
                  <div key={k}>
                    <span>{k}</span>
                    <code>{String(typeof v === 'object' ? JSON.stringify(v) : v)}</code>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
      {!resolved && (
        <div className="hitl-actions">
          <button
            type="button"
            className="suggest-chip"
            aria-label="Cancel action"
            onClick={() => onDecide(item.step, item.call.id, false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="composer-send"
            style={{ width: 'auto', padding: '0 12px', borderRadius: 8 }}
            aria-label="Approve action"
            onClick={() => onDecide(item.step, item.call.id, true)}
          >
            Approve
          </button>
        </div>
      )}
    </div>
  );
}

function summarizeArgs(args: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(args);
    return s.length > 120 ? `${s.slice(0, 120)}…` : s;
  } catch {
    return '';
  }
}

const MODES: { v: ChatMode; l: string; title: string }[] = [
  { v: 'auto', l: 'Auto', title: 'Auto: answer simple questions cheaply, use the agent for page tasks' },
  { v: 'ask', l: 'Ask', title: 'Ask: plain chat only — no tools, cheapest' },
  { v: 'agent', l: 'Agent', title: 'Agent: always plan and use tools' },
];

function ChatComposer({
  input,
  onChange,
  onSend,
  busy,
  mode,
  onMode,
  attachPage,
  onAttachPage,
}: {
  input: string;
  onChange: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  mode: ChatMode;
  onMode: (m: ChatMode) => void;
  attachPage: boolean;
  onAttachPage: () => void;
}) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };
  return (
    <div className="composer">
      <div className="composer-bar">
        <button type="button" className="composer-attach" aria-label="Attach">
          <span className="ic">{Ic.attach}</span>
        </button>
        <textarea
          className="composer-input"
          placeholder="Message Buddy…"
          value={input}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          aria-label="Message Buddy"
        />
        <button type="button" className="composer-mic" aria-label="Voice">
          <span className="ic">{Ic.mic}</span>
        </button>
        <button
          type="button"
          className="composer-send"
          aria-label="Send"
          disabled={!input.trim() || busy}
          onClick={onSend}
        >
          <span className="ic">{Ic.send}</span>
        </button>
      </div>
      <div className="composer-foot">
        <div className="seg seg-sm" role="group" aria-label="Chat mode">
          {MODES.map((m) => (
            <button
              key={m.v}
              type="button"
              className={'seg-btn' + (mode === m.v ? ' is-on' : '')}
              onClick={() => onMode(m.v)}
              title={m.title}
              aria-pressed={mode === m.v}
            >
              {m.l}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={'ctx-chip' + (attachPage ? ' is-on' : '')}
          onClick={onAttachPage}
          aria-pressed={attachPage}
          title={attachPage ? 'Including this page with your message' : 'Page not attached'}
        >
          <span className="ctx-chip-dot" style={attachPage ? undefined : { background: 'var(--panel-muted-soft)' }} />
          This page
        </button>
      </div>
    </div>
  );
}
