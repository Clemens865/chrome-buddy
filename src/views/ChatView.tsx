// ChatView.tsx — agentic chat wired to the real AgentRuntime + Gemini.
//
// The user types a task → Gemini plans (via the background SW) → page tools run
// in the SW on the active tab → step traces + HITL confirmation cards render
// inline → final answer. The API key is never touched here; everything routes
// through the background (see src/agent/runner.ts for the security posture).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PendingRun } from '../ui/PanelApp';
import type { Workflow } from '../workflows/types';
import { Ic, BuddyMark } from '../ui/icons';
import { Markdown } from '../ui/Markdown';
import { ArtifactCard, ArtifactView } from './Artifacts';
import { extractArtifacts, type Artifact } from '../artifacts/extract';
import { usePersistedState } from '../sidepanel/usePersistedState';
import { requestPageContext } from '../page/request';
import { persistRun, fetchRuns } from '../memory/request';
import { buildRunRecord } from '../memory/buildRecord';
import { findSimilarRun } from '../memory/recall';
import type { RunRecord } from '../memory/types';
import {
  BUDGET_KEYS,
  BUDGET_DEFAULTS,
  getTodaySpend,
  addSpend,
  isOverDailyCap,
} from '../cost/budget';
import { useActiveModel } from '../llm/modelPref';
import {
  isSTTSupported,
  isTTSSupported,
  createRecognizer,
  speak,
  stopSpeaking,
  type Recognizer,
} from '../voice/speech';
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
  type ChatMode,
  type TranscriptItem,
  type Profiles,
  type ProfileKind,
} from '../agent';

import type { AgentEvent, ApprovalDecision, PlanStep, PlanDecision } from '../agent';

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

export function ChatView({
  pendingRun,
  onConsumePending,
  pendingWorkflow,
  onConsumeWorkflow,
}: {
  pendingRun?: PendingRun | null;
  onConsumePending?: () => void;
  pendingWorkflow?: Workflow | null;
  onConsumeWorkflow?: () => void;
} = {}) {
  const [input, setInput] = useState('');
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [noKey, setNoKey] = useState(false);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [mode, setMode] = usePersistedState<ChatMode>('chatMode', 'auto');
  const [attachPage, setAttachPage] = usePersistedState<boolean>('attachPage', true);
  const [profiles] = usePersistedState<Profiles>('userProfiles', EMPTY_PROFILES);
  const [activeProfile] = usePersistedState<ProfileKind>('activeProfile', 'professional');
  const [attachProfile] = usePersistedState<boolean>('attachProfile', false);
  const [activeModel] = useActiveModel();
  const [sessionCost, setSessionCost] = useState(0);
  const [perRunCap] = usePersistedState<number>(BUDGET_KEYS.perRun, BUDGET_DEFAULTS.perRun);
  const [perDayCap] = usePersistedState<number>(BUDGET_KEYS.perDay, BUDGET_DEFAULTS.perDay);
  const [stepBudget] = usePersistedState<number>(BUDGET_KEYS.steps, BUDGET_DEFAULTS.steps);
  const [spentToday, setSpentToday] = useState(0);
  const [askBeforePlan] = usePersistedState<boolean>('askBeforePlan', true);
  const [planReview, setPlanReview] = useState<{ plan: PlanStep[]; resolve: (d: PlanDecision) => void } | null>(null);
  const [askUser, setAskUser] = useState<{ question: string; choices?: string[]; resolve: (a: string) => void } | null>(null);
  const [pastRuns, setPastRuns] = useState<RunRecord[]>([]);

  useEffect(() => {
    void getTodaySpend().then(setSpentToday);
  }, []);

  // Record a call's cost: session total (UI) + the persistent daily ledger.
  const recordCost = useCallback((amount: number) => {
    if (!amount) return;
    setSessionCost((c) => c + amount);
    void addSpend(amount).then(setSpentToday);
  }, []);
  const pendingRef = useRef<PendingConfirm | null>(null);

  // Learned-flow recall: keep recent runs handy and suggest reusing a similar
  // past one as the user types. Reload when a run finishes (busy -> false).
  useEffect(() => {
    if (!busy) void fetchRuns().then(setPastRuns);
  }, [busy]);
  const recall = useMemo(
    () => (input.trim().length >= 6 ? findSimilarRun(input, pastRuns) : null),
    [input, pastRuns],
  );
  const seqRef = useRef(0);

  // Plan-approval gate (FR-AGENT-3): hold the resolver until the user decides.
  const onPlanReview = useCallback(
    (req: { runId: string; plan: PlanStep[] }) =>
      new Promise<PlanDecision>((resolve) => setPlanReview({ plan: req.plan, resolve })),
    [],
  );
  const decidePlan = useCallback((approved: boolean) => {
    setPlanReview((cur) => {
      cur?.resolve(approved ? { approved: true } : { approved: false });
      return null;
    });
  }, []);

  // ask_user (FR-TOOLS-11): pause and surface a question; resume on the answer.
  const onAskUser = useCallback(
    (req: { question: string; choices?: string[] }) =>
      new Promise<string>((resolve) => setAskUser({ question: req.question, choices: req.choices, resolve })),
    [],
  );
  const answerAsk = useCallback((answer: string) => {
    setAskUser((cur) => {
      cur?.resolve(answer);
      return null;
    });
  }, []);

  const submit = useCallback(
    async (text: string, forceMode?: ChatMode) => {
      const prompt = text.trim();
      if (!prompt || busy) return;
      // NFR-COST-1: hard-stop new runs once the daily cap is hit. Raising the
      // cap in Settings is the explicit "continue".
      if (isOverDailyCap(spentToday, perDayCap)) {
        setItems((prev) => [
          ...prev,
          {
            kind: 'error',
            id: `cap_${seqRef.current++}`,
            text: `Daily spend cap reached (≈ $${spentToday.toFixed(2)} of $${perDayCap.toFixed(2)}). Raise it in Settings → Budget to continue.`,
          },
        ]);
        return;
      }
      const effectiveMode = forceMode ?? mode;
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
        if (resolveIntent(effectiveMode, prompt) === 'chat') {
          // Attach the page content (so chat sees the page without an agentic
          // read_dom round-trip) and/or the user profile, per the toggles.
          const active = profiles[activeProfile];
          const useProfile = attachProfile && hasProfile(active);
          const page = attachPage ? await requestPageContext() : null;
          const context = buildContextBlock(page, useProfile ? active : null, activeProfile);
          const r = await runPlainChat(prompt, { context, model: activeModel });
          if (r.outcome === 'no-key') setNoKey(true);
          else if (r.text) {
            recordCost(r.cost ?? 0);
            setItems((prev) => [...prev, agentItem(`a_${seqRef.current++}`, r.text!)]);
            void persistRun(
              buildRunRecord({ kind: 'chat', task: prompt, answer: r.text, model: activeModel, startedAt }),
            );
          }
        } else {
          const result = await runAgentTask(prompt, {
            onEvent,
            onConfirm,
            onPlanReview: askBeforePlan ? onPlanReview : undefined,
            onAskUser,
            model: activeModel,
            costBudget: perRunCap,
            stepBudget,
          });
          if (result.outcome === 'no-key') setNoKey(true);
          else if (result.state) {
            recordCost(result.state?.costUsed ?? 0);
            const sp = result.state.scratchpad;
            void persistRun(
              buildRunRecord({
                kind: 'agent',
                task: prompt,
                answer: result.state.finalAnswer ?? '',
                outcome: result.outcome,
                tools: sp.actions.map((a) => a.toolName),
                provenance: sp.provenance,
                model: activeModel,
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
    [busy, mode, attachPage, attachProfile, profiles, activeProfile, activeModel, recordCost, spentToday, perDayCap, perRunCap, stepBudget, askBeforePlan, onPlanReview, onAskUser],
  );

  const decide = useCallback((step: number, callId: string, approved: boolean) => {
    setItems((prev) => resolveConfirmation(prev, step, callId, approved ? 'approved' : 'denied'));
    const pending = pendingRef.current;
    if (pending && pending.step === step) {
      pending.resolve(approved ? { approved: true } : { approved: false });
      pendingRef.current = null;
    }
  }, []);

  // Shared HITL confirm handler: holds the resolver until the user clicks a card.
  const makeOnConfirm = useCallback(
    () =>
      (req: { runId: string; step: number; tool: string; args: Record<string, unknown>; summary: string }) =>
        new Promise<ApprovalDecision>((resolve) => {
          pendingRef.current = { step: req.step, callId: req.summary, resolve };
        }),
    [],
  );

  // Run a workflow's steps in sequence, threading each step's result forward.
  const runWorkflow = useCallback(
    async (wf: Workflow) => {
      if (busy) return;
      setBusy(true);
      setNoKey(false);
      setItems((prev) => [...prev, userItem(`wf_${seqRef.current++}`, `▶ Workflow: ${wf.name}`)]);
      let context = '';
      try {
        for (let i = 0; i < wf.steps.length; i++) {
          const step = wf.steps[i];
          setItems((prev) => [...prev, userItem(`wfs_${seqRef.current++}`, `Step ${i + 1}: ${step.prompt}`)]);
          const fullPrompt = context
            ? `${step.prompt}\n\n[Context from earlier steps:\n${context}\n]`
            : step.prompt;

          if (step.mode === 'chat') {
            const r = await runPlainChat(fullPrompt, { model: activeModel });
            if (r.outcome === 'no-key') { setNoKey(true); break; }
            recordCost(r.cost ?? 0);
            const text = r.text ?? '';
            setItems((prev) => [...prev, agentItem(`wfa_${seqRef.current++}`, text)]);
            context += `\n\nStep ${i + 1} result:\n${text}`;
          } else {
            const onEvent = (e: AgentEvent) => setItems((prev) => reduceTranscript(prev, e));
            const result = await runAgentTask(fullPrompt, {
              onEvent,
              onConfirm: makeOnConfirm(),
              onPlanReview: askBeforePlan ? onPlanReview : undefined,
              onAskUser,
              model: activeModel,
              costBudget: perRunCap,
              stepBudget,
            });
            if (result.outcome === 'no-key') { setNoKey(true); break; }
            recordCost(result.state?.costUsed ?? 0);
            context += `\n\nStep ${i + 1} result:\n${result.state?.finalAnswer ?? ''}`;
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setItems((prev) => [...prev, { kind: 'error', id: `werr_${seqRef.current++}`, text: message }]);
      } finally {
        pendingRef.current = null;
        setBusy(false);
      }
    },
    [busy, makeOnConfirm, activeModel, recordCost, perRunCap, stepBudget, askBeforePlan, onPlanReview, onAskUser],
  );

  // Running a skill (from the Skills view) submits its task in the skill's mode.
  useEffect(() => {
    if (!pendingRun) return;
    void submit(pendingRun.prompt, pendingRun.mode);
    onConsumePending?.();
  }, [pendingRun]); // eslint-disable-line react-hooks/exhaustive-deps

  // Running a workflow (from the Workflows view) executes its steps in sequence.
  useEffect(() => {
    if (!pendingWorkflow) return;
    void runWorkflow(pendingWorkflow);
    onConsumeWorkflow?.();
  }, [pendingWorkflow]); // eslint-disable-line react-hooks/exhaustive-deps

  const isEmpty = items.length === 0 && !noKey;

  return (
    <div className="chat">
      {artifact && <ArtifactView artifact={artifact} onClose={() => setArtifact(null)} />}
      <div className="chat-scroller">
        {isEmpty ? (
          <Greeting onPick={setInput} />
        ) : (
          <>
            {items.map((it) => (
              <TranscriptRow key={it.id} item={it} onDecide={decide} onOpenArtifact={setArtifact} />
            ))}
            {noKey && <NoKeyNotice />}
          </>
        )}
      </div>
      {askUser && <AskUserCard question={askUser.question} choices={askUser.choices} onAnswer={answerAsk} />}
      {planReview && (
        <div className="plan-review" role="group" aria-label="Review plan">
          <div className="plan-review-hd">Review plan before running</div>
          <ol className="plan-review-list">
            {planReview.plan.map((p) => (
              <li key={p.index}>{p.intent}</li>
            ))}
          </ol>
          <div className="plan-review-actions">
            <button type="button" className="suggest-chip" onClick={() => decidePlan(false)}>Cancel</button>
            <button
              type="button"
              className="composer-send"
              style={{ width: 'auto', padding: '0 12px', borderRadius: 8 }}
              aria-label="Approve plan"
              onClick={() => decidePlan(true)}
            >
              Approve &amp; run
            </button>
          </div>
        </div>
      )}
      {recall && !busy && (
        <button
          type="button"
          className="recall-chip"
          onClick={() => void submit(recall.run.task, recall.run.kind === 'agent' ? 'agent' : 'ask')}
          title="Reuse a similar past run"
        >
          <span className="ic">{Ic.history}</span>
          <span className="recall-chip-txt">Reuse: {recall.run.task}</span>
        </button>
      )}
      <ChatComposer
        input={input}
        onChange={setInput}
        onSend={() => void submit(input)}
        busy={busy}
        mode={mode}
        onMode={setMode}
        attachPage={attachPage}
        onAttachPage={() => setAttachPage(!attachPage)}
        sessionCost={sessionCost}
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

function AgentBody({ text, onOpenArtifact }: { text: string; onOpenArtifact: (a: Artifact) => void }) {
  const { text: stripped, artifacts } = extractArtifacts(text);
  if (artifacts.length === 0) return <Markdown>{text}</Markdown>;
  // Interleave prose segments with artifact cards in original order.
  const parts = stripped.split(/\[\[ARTIFACT:(art_\d+)\]\]/);
  return (
    <>
      {parts.map((part, idx) => {
        if (idx % 2 === 1) {
          const a = artifacts.find((x) => x.id === part);
          return a ? <ArtifactCard key={part} artifact={a} onOpen={() => onOpenArtifact(a)} /> : null;
        }
        return part.trim() ? <Markdown key={`p${idx}`}>{part}</Markdown> : null;
      })}
    </>
  );
}

// Read an answer aloud (TTS). Hidden when the browser has no speechSynthesis.
function SpeakButton({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false);
  if (!isTTSSupported() || !text.trim()) return null;
  const toggle = () => {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    if (speak(text, { onEnd: () => setSpeaking(false) })) setSpeaking(true);
  };
  return (
    <button
      type="button"
      className={'msg-speak' + (speaking ? ' is-on' : '')}
      aria-label={speaking ? 'Stop reading' : 'Read aloud'}
      aria-pressed={speaking}
      title="Read aloud"
      onClick={toggle}
    >
      <span className="ic">{Ic.speaker}</span>
    </button>
  );
}

function TranscriptRow({
  item,
  onDecide,
  onOpenArtifact,
}: {
  item: TranscriptItem;
  onDecide: (step: number, callId: string, approved: boolean) => void;
  onOpenArtifact: (a: Artifact) => void;
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
          <div className="msg-body">
            <AgentBody text={item.text} onOpenArtifact={onOpenArtifact} />
            <SpeakButton text={item.text} />
          </div>
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

// Inline prompt for the ask_user tool: choice buttons or a free-text answer.
function AskUserCard({
  question,
  choices,
  onAnswer,
}: {
  question: string;
  choices?: string[];
  onAnswer: (answer: string) => void;
}) {
  const [text, setText] = useState('');
  const hasChoices = !!choices && choices.length > 0;
  return (
    <div className="ask-user" role="group" aria-label="Question from Buddy">
      <div className="ask-user-q">{question}</div>
      {hasChoices ? (
        <div className="ask-user-choices">
          {choices!.map((c) => (
            <button key={c} type="button" className="suggest-chip" onClick={() => onAnswer(c)}>
              {c}
            </button>
          ))}
        </div>
      ) : (
        <div className="ask-user-form">
          <input
            className="settings-input"
            placeholder="Your answer…"
            value={text}
            autoFocus
            aria-label="Answer"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && text.trim()) onAnswer(text.trim());
            }}
          />
          <button type="button" className="composer-send" style={{ width: 'auto', padding: '0 12px', borderRadius: 8 }} aria-label="Send answer" disabled={!text.trim()} onClick={() => onAnswer(text.trim())}>
            Answer
          </button>
        </div>
      )}
    </div>
  );
}

function ChatComposer({
  input,
  onChange,
  onSend,
  busy,
  mode,
  onMode,
  attachPage,
  onAttachPage,
  sessionCost,
}: {
  input: string;
  onChange: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  mode: ChatMode;
  onMode: (m: ChatMode) => void;
  attachPage: boolean;
  onAttachPage: () => void;
  sessionCost: number;
}) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  // Voice input (STT): toggle the mic; transcribed text is appended to the box.
  const [listening, setListening] = useState(false);
  const recRef = useRef<Recognizer | null>(null);
  const baseRef = useRef('');
  const sttSupported = isSTTSupported();

  const toggleMic = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    baseRef.current = input ? input.trimEnd() + ' ' : '';
    const rec = createRecognizer({
      onResult: (text) => onChange(baseRef.current + text),
      onEnd: () => setListening(false),
      onError: () => setListening(false),
    });
    if (!rec) return;
    recRef.current = rec;
    setListening(true);
    rec.start();
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
        <button
          type="button"
          className={'composer-mic' + (listening ? ' is-listening' : '')}
          aria-label={listening ? 'Stop voice input' : 'Voice input'}
          aria-pressed={listening}
          disabled={!sttSupported}
          title={sttSupported ? 'Voice input' : 'Voice input not supported in this browser'}
          onClick={toggleMic}
        >
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
        <div className="composer-foot-r">
          {sessionCost > 0 && (
            <span className="cost-chip" title="Estimated spend this session (BYO key)">
              {sessionCost < 0.0001
                ? '< $0.0001'
                : `≈ $${sessionCost < 0.01 ? sessionCost.toFixed(4) : sessionCost.toFixed(2)}`}
            </span>
          )}
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
    </div>
  );
}
