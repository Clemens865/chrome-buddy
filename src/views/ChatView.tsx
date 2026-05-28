// ChatView.tsx — agentic chat wired to the real AgentRuntime + Gemini.
//
// The user types a task → Gemini plans (via the background SW) → page tools run
// in the SW on the active tab → step traces + HITL confirmation cards render
// inline → final answer. The API key is never touched here; everything routes
// through the background (see src/agent/runner.ts for the security posture).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PendingRun } from '../ui/PanelApp';
import type { Workflow } from '../workflows/types';
import { Ic, BuddyMark } from '../ui/icons';
import { Markdown } from '../ui/Markdown';
import { ArtifactCard, ArtifactView } from './Artifacts';
import { extractArtifacts, type Artifact } from '../artifacts/extract';
import {
  classifyFile,
  formatBytes,
  formatTextAttachments,
  imageAttachments,
  totalBytes,
  MAX_ATTACHMENTS,
  MAX_TOTAL_BYTES,
  type ChatAttachment,
} from '../chat/attachments';
import { usePersistedState } from '../sidepanel/usePersistedState';
import { requestPageContext } from '../page/request';
import { persistRun, fetchRuns } from '../memory/request';
import { buildRunRecord } from '../memory/buildRecord';
import { findSimilarRun } from '../memory/recall';
import { runVisionTask } from '../agent/visionLoop';
import { ensureRootPermission } from '../fs/root';
import type { RunRecord } from '../memory/types';
import { loadCheckpoint, clearCheckpoint, type RunCheckpoint } from '../agent/checkpoint';
import {
  saveConversation,
  listConversations,
  getConversation,
  deleteConversation,
  deriveTitle,
  type Conversation,
} from '../chat/store';
import { mirrorChat } from '../library/mirror';
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
import { VoiceSession, isVoiceSupported, type VoiceEvent } from '../voice/liveSession';
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
interface LibraryAutoContextHit {
  title: string;
  source: string;
  snippet: string;
}

interface PendingConfirm {
  step: number;
  callId: string;
  tool: string;
  resolve: (decision: ApprovalDecision) => void;
}

/** The last few user/agent turns, so an agent run can resolve references like
 *  "this file" to what was established earlier in the conversation. */
function recentHistory(items: TranscriptItem[], max = 6): string {
  return items
    .filter((it): it is Extract<TranscriptItem, { kind: 'user' | 'agent' }> => it.kind === 'user' || it.kind === 'agent')
    .slice(-max)
    .map((it) => `${it.kind === 'user' ? 'User' : 'Buddy'}: ${it.text}`)
    .join('\n');
}

export function ChatView({
  pendingRun,
  onConsumePending,
  pendingWorkflow,
  onConsumeWorkflow,
  newChatSignal = 0,
  chatListOpen = false,
  onCloseChatList,
}: {
  pendingRun?: PendingRun | null;
  onConsumePending?: () => void;
  pendingWorkflow?: Workflow | null;
  onConsumeWorkflow?: () => void;
  /** Bumped by the header "+" to start a new chat. */
  newChatSignal?: number;
  /** Whether the conversation-list slide-over is open (header list icon). */
  chatListOpen?: boolean;
  onCloseChatList?: () => void;
} = {}) {
  const [input, setInput] = useState('');
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [noKey, setNoKey] = useState(false);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [mode, setMode] = usePersistedState<ChatMode>('chatMode', 'auto');
  const [attachPage, setAttachPage] = usePersistedState<boolean>('attachPage', true);
  // H7 P3 — "Confirm every Vision action" toggle. Default OFF: only
  // safety_decision = require_confirmation actions gate (per docs).
  const [visionConfirmAll] = usePersistedState<boolean>('visionConfirmAll', false);
  // H2 — per-turn "Think harder" toggle: synthesis runs at thinking:'high'.
  // Not persisted; resets to off after each submit so the user opts in per turn.
  const [thinkHarder, setThinkHarder] = useState(false);
  const [profiles] = usePersistedState<Profiles>('userProfiles', EMPTY_PROFILES);
  const [activeProfile] = usePersistedState<ProfileKind>('activeProfile', 'professional');
  const [attachProfile] = usePersistedState<boolean>('attachProfile', false);
  // Composer file attachments (images + text files). Transient — cleared on
  // every successful submit. Persisting them across reloads doesn't carry
  // useful semantics; the user re-picks if they want to send again.
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [activeModel] = useActiveModel();
  const [sessionCost, setSessionCost] = useState(0);
  const [perRunCap] = usePersistedState<number>(BUDGET_KEYS.perRun, BUDGET_DEFAULTS.perRun);
  const [perDayCap] = usePersistedState<number>(BUDGET_KEYS.perDay, BUDGET_DEFAULTS.perDay);
  const [stepBudget] = usePersistedState<number>(BUDGET_KEYS.steps, BUDGET_DEFAULTS.steps);
  const [spentToday, setSpentToday] = useState(0);
  const [askBeforePlan] = usePersistedState<boolean>('askBeforePlan', true);
  const [preferNano] = usePersistedState<boolean>('preferNano', false);
  const [libraryAutoContext] = usePersistedState<boolean>('libraryAutoContext', false);
  // Default repo configured in Settings → GitHub. Passed into the agent's
  // RunOptions.defaults so the planner knows which repo to fill on
  // github_write / github_read / github_list when the user doesn't name one.
  const [githubDefaultRepo] = usePersistedState<string>('githubDefaultRepo', '');
  const [planReview, setPlanReview] = useState<{ plan: PlanStep[]; resolve: (d: PlanDecision) => void } | null>(null);
  const [askUser, setAskUser] = useState<{ question: string; choices?: string[]; resolve: (a: string) => void } | null>(null);
  const [humanGate, setHumanGate] = useState<{ kind: 'captcha' | 'login'; resolve: () => void } | null>(null);
  const [resumable, setResumable] = useState<RunCheckpoint | null>(null);
  const [pastRuns, setPastRuns] = useState<RunRecord[]>([]);

  useEffect(() => {
    void getTodaySpend().then(setSpentToday);
    // FR-AGENT-8: offer to resume a run that was interrupted (panel closed mid-run).
    void loadCheckpoint().then((cp) => {
      if (cp && !cp.state.outcome) setResumable(cp);
    });
  }, []);

  // Record a call's cost: session total (UI) + the persistent daily ledger.
  const recordCost = useCallback((amount: number) => {
    if (!amount) return;
    setSessionCost((c) => c + amount);
    void addSpend(amount).then(setSpentToday);
  }, []);
  const pendingRef = useRef<PendingConfirm | null>(null);
  /** Active AbortController for the in-flight run. Cleared back to null when
   *  the run resolves so the Stop button only shows during real work. */
  const abortRef = useRef<AbortController | null>(null);
  /** When auto-context fires, we stash the snippets that got injected,
   *  keyed by the user-message id that triggered them. The transcript then
   *  renders a collapsible "From your Library" card right after that
   *  user message so the user can audit what the model actually saw. */
  const [libraryHits, setLibraryHits] = useState<Record<string, LibraryAutoContextHit[]>>({});
  /** Live voice session (Gemini Live). Null when idle; populated while a
   *  WebSocket session is open. The session emits transcript + open / close
   *  events; we mirror them into the existing items[] transcript. */
  const voiceRef = useRef<VoiceSession | null>(null);
  const [voiceState, setVoiceState] = useState<'idle' | 'connecting' | 'live' | 'error'>('idle');
  const [voiceError, setVoiceError] = useState<string | undefined>();
  /** Real-time bidirectional flow counters surfaced from VoiceSession. The
   *  user clicks "Start voice" and immediately sees "Sent 3 · Received 0"
   *  ticking — concrete proof audio is reaching the SW. Once Gemini starts
   *  responding, the received counter ticks too. */
  const [voiceFlow, setVoiceFlow] = useState<{ sent: number; sentB: number; recv: number; recvB: number; played: number } | undefined>();
  /** Live-API TRANSCRIPT chunks arrive as DELTAS (small fragments), each
   *  often flagged finished:true. Each role gets one bubble per turn; we
   *  CONCATENATE chunks into it and only close the bubble when the OTHER
   *  role's chunk arrives (turn boundary) or on TURN_DONE. */
  const voiceUserBubbleRef = useRef<{ id: string; text: string } | null>(null);
  const voiceModelBubbleRef = useRef<{ id: string; text: string } | null>(null);
  // Mirror items so the (memoised) submit closure can read the latest transcript.
  const itemsRef = useRef<TranscriptItem[]>(items);
  itemsRef.current = items;

  // Auto-scroll the transcript to the newest content (so confirm cards, answers,
  // and tool traces stay in view). We "stick" to the bottom unless the user has
  // scrolled up to read history, so a long card's Approve button is reachable.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const onScrollerScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  }, []);

  // --- Multi-session chat history -----------------------------------------
  const [activeChatId, setActiveChatId] = usePersistedState<string>('activeChatId', '');
  const [convs, setConvs] = useState<Conversation[] | null>(null);
  const loadedIdRef = useRef<string>('');
  const chatCreatedRef = useRef<number>(0);

  // Restore the last conversation when its id hydrates (and we're still empty).
  useEffect(() => {
    if (!activeChatId || loadedIdRef.current === activeChatId || items.length > 0) return;
    void getConversation(activeChatId).then((c) => {
      if (c) {
        loadedIdRef.current = c.id;
        chatCreatedRef.current = c.createdAt;
        setItems(c.items);
      }
    });
  }, [activeChatId, items.length]);

  // Persist the active conversation when a turn settles (creates an id lazily).
  useEffect(() => {
    if (busy || items.length === 0) return;
    let id = activeChatId;
    if (!id) {
      id = `chat_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      chatCreatedRef.current = Date.now();
      loadedIdRef.current = id;
      setActiveChatId(id);
    }
    const conv: Conversation = {
      id,
      title: deriveTitle(items),
      items,
      createdAt: chatCreatedRef.current || Date.now(),
      updatedAt: Date.now(),
    };
    void saveConversation(conv);
    // Mirror into the library RAG index (fire-and-forget; idempotent on
    // unchanged content via contentHash so this is cheap on every save).
    mirrorChat(conv);
  }, [busy, items]); // eslint-disable-line react-hooks/exhaustive-deps

  const startNewChat = useCallback(() => {
    setItems([]);
    setInput('');
    setNoKey(false);
    loadedIdRef.current = '';
    chatCreatedRef.current = 0;
    setActiveChatId('');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Voice session — start the Gemini Live socket + mic capture. Transcripts
   *  flow into the existing items[] state. The model's audio replies play
   *  automatically; we render the spoken text as it arrives. */
  const startVoice = useCallback(async () => {
    if (voiceRef.current) return;
    setVoiceError(undefined);
    setVoiceState('connecting');
    setVoiceFlow({ sent: 0, sentB: 0, recv: 0, recvB: 0, played: 0 });
    const onEvent = (e: VoiceEvent) => {
      switch (e.kind) {
        case 'open':
          setVoiceState('live');
          break;
        case 'transcript': {
          // CONCATENATE chunks into the role's current bubble. The Live API
          // sends deltas, often with finished:true on EVERY chunk — treating
          // finished as "close the bubble" produced the fragmentation bug
          // (one bubble per word). Bubbles close when the opposite role
          // speaks or on turn-done.
          if (e.role === 'user') {
            // Model's turn ended — drop its bubble ref so the next model
            // chunk starts fresh.
            if (voiceModelBubbleRef.current) voiceModelBubbleRef.current = null;
            const cur = voiceUserBubbleRef.current;
            if (!cur) {
              const id = `vu_${seqRef.current++}`;
              voiceUserBubbleRef.current = { id, text: e.text };
              setItems((prev) => [...prev, userItem(id, e.text)]);
            } else {
              const text = cur.text + e.text;
              voiceUserBubbleRef.current = { id: cur.id, text };
              setItems((prev) =>
                prev.map((it) => (it.kind === 'user' && it.id === cur.id ? { ...it, text } : it)),
              );
            }
          } else {
            if (voiceUserBubbleRef.current) voiceUserBubbleRef.current = null;
            const cur = voiceModelBubbleRef.current;
            if (!cur) {
              const id = `va_${seqRef.current++}`;
              voiceModelBubbleRef.current = { id, text: e.text };
              setItems((prev) => [...prev, agentItem(id, e.text)]);
            } else {
              const text = cur.text + e.text;
              voiceModelBubbleRef.current = { id: cur.id, text };
              setItems((prev) =>
                prev.map((it) => (it.kind === 'agent' && it.id === cur.id ? { ...it, text } : it)),
              );
            }
          }
          break;
        }
        case 'turn-done':
          voiceUserBubbleRef.current = null;
          voiceModelBubbleRef.current = null;
          break;
        case 'interrupted':
          // Drop both refs so any post-interrupt chunks start fresh bubbles.
          voiceUserBubbleRef.current = null;
          voiceModelBubbleRef.current = null;
          break;
        case 'flow':
          setVoiceFlow({ sent: e.sentChunks, sentB: e.sentBytes, recv: e.recvChunks, recvB: e.recvBytes, played: e.playedChunks });
          break;
        case 'error':
          setVoiceError(e.message);
          setVoiceState('error');
          break;
        case 'closed':
          setVoiceState('idle');
          voiceRef.current = null;
          voiceUserBubbleRef.current = null;
          voiceModelBubbleRef.current = null;
          setVoiceFlow(undefined);
          break;
      }
    };
    const session = new VoiceSession({ onEvent });
    voiceRef.current = session;
    try {
      await session.start();
    } catch (e) {
      setVoiceError(e instanceof Error ? e.message : 'Voice session failed to start.');
      setVoiceState('error');
      voiceRef.current = null;
    }
  }, []);

  const stopVoice = useCallback(async () => {
    const session = voiceRef.current;
    voiceRef.current = null;
    setVoiceState('idle');
    setVoiceError(undefined);
    voiceUserBubbleRef.current = null;
    voiceModelBubbleRef.current = null;
    if (session) await session.stop();
  }, []);

  // Auto-stop voice when the user switches away from 'voice' mode.
  useEffect(() => {
    if (mode !== 'voice' && voiceRef.current) void stopVoice();
  }, [mode, stopVoice]);

  // Cleanup on unmount.
  useEffect(() => () => { void voiceRef.current?.stop(); }, []);

  const openConversation = useCallback((c: Conversation) => {
    loadedIdRef.current = c.id;
    chatCreatedRef.current = c.createdAt;
    setItems(c.items);
    setActiveChatId(c.id);
    onCloseChatList?.();
  }, [onCloseChatList]); // eslint-disable-line react-hooks/exhaustive-deps

  const removeConversation = useCallback(
    async (id: string) => {
      await deleteConversation(id);
      setConvs(await listConversations());
      if (id === activeChatId) startNewChat();
    },
    [activeChatId, startNewChat],
  );

  // Header "+" → new chat.
  useEffect(() => {
    if (newChatSignal > 0) startNewChat();
  }, [newChatSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load the conversation list when the slide-over opens.
  useEffect(() => {
    if (chatListOpen) void listConversations().then(setConvs);
  }, [chatListOpen]);

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

  // Human handoff (FR-HITL-8): pause on a CAPTCHA/login wall; resume on click.
  const onHumanGate = useCallback(
    (req: { kind: 'captcha' | 'login' }) =>
      new Promise<void>((resolve) => setHumanGate({ kind: req.kind, resolve })),
    [],
  );
  const resumeGate = useCallback(() => {
    setHumanGate((cur) => {
      cur?.resolve();
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
      setAttachments([]); // attachments are one-shot per turn
      setAttachError(null);
      setNoKey(false);
      setBusy(true);
      // Fresh AbortController per run. The Stop button calls
      // abortRef.current?.abort(); the runtime + plain-chat both honor it.
      const aborter = new AbortController();
      abortRef.current = aborter;
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
          pendingRef.current = { step: req.step, callId: req.summary, tool: req.tool, resolve };
        });

      try {
        // VISION mode (Computer Use): Buddy SEES the active tab and drives it
        // click-by-click via the gemini-2.5-computer-use-preview model.
        // Bypasses the planner/executor — its own loop.
        if (effectiveMode === 'vision') {
          let lastNarration = '';
          const result = await runVisionTask({
            task: prompt,
            confirmAll: visionConfirmAll,
            onConfirm: async ({ call, summary }) =>
              new Promise<ApprovalDecision>((resolve) => {
                pendingRef.current = { step: 0, callId: summary, tool: call.name, resolve };
                // Render a confirm card by emitting a confirmation_required-ish item.
                setItems((prev) => [
                  ...prev,
                  {
                    kind: 'confirm',
                    id: `vis_${seqRef.current++}`,
                    step: 0,
                    call: { id: `vc_${seqRef.current++}`, name: call.name, arguments: call.args },
                    summary,
                  },
                ]);
              }),
            onEvent: (ev) => {
              if (ev.kind === 'narration') {
                lastNarration = ev.text;
                setItems((prev) => [...prev, agentItem(`vn_${seqRef.current++}`, ev.text)]);
              } else if (ev.kind === 'action') {
                setItems((prev) => [
                  ...prev,
                  {
                    kind: 'tool',
                    id: `vt_${seqRef.current++}`,
                    step: 0,
                    call: { id: `vc_${seqRef.current++}`, name: ev.call.name, arguments: ev.call.args },
                    status: 'running',
                  },
                ]);
              } else if (ev.kind === 'action-result') {
                setItems((prev) => {
                  const idx = [...prev].reverse().findIndex((it) => it.kind === 'tool' && it.status === 'running');
                  if (idx < 0) return prev;
                  const realIdx = prev.length - 1 - idx;
                  const item = prev[realIdx];
                  if (item.kind !== 'tool') return prev;
                  return [
                    ...prev.slice(0, realIdx),
                    { ...item, status: 'done', verdict: ev.ok ? 'succeeded' : 'failed' },
                    ...prev.slice(realIdx + 1),
                  ];
                });
              }
            },
          });
          // Skip pushing the final-answer bubble if it duplicates the last
          // narration we already streamed (the model often emits the same text
          // again as its closing turn).
          if (result.finalAnswer && result.finalAnswer.trim() !== lastNarration.trim()) {
            setItems((prev) => [...prev, agentItem(`vd_${seqRef.current++}`, result.finalAnswer)]);
          }
          // Cost ledger + persist the run for History (FR-AGENT-7).
          recordCost(result.costUsd);
          void persistRun(
            buildRunRecord({
              kind: 'agent',
              task: prompt,
              answer: result.finalAnswer,
              outcome: result.outcome === 'completed' ? 'completed' : result.outcome === 'budget-exceeded' ? 'budget-exceeded' : result.outcome === 'cancelled' ? 'cancelled' : 'failed',
              tools: [],
              provenance: [],
              model: 'gemini-2.5-computer-use-preview-10-2025',
              startedAt,
            }),
          );
        }
        // Auto-route (or honor the forced mode): simple Q&A → cheap tool-less
        // chat; page/action intent → the full agentic loop.
        else if (resolveIntent(effectiveMode, prompt) === 'chat') {
          // Attach the page content (so chat sees the page without an agentic
          // read_dom round-trip) and/or the user profile, per the toggles.
          const active = profiles[activeProfile];
          const useProfile = attachProfile && hasProfile(active);
          const page = attachPage ? await requestPageContext() : null;
          let context = buildContextBlock(page, useProfile ? active : null, activeProfile);
          // Text-file attachments fold into the system context as fenced blocks;
          // image attachments stay on the user message as multimodal parts.
          if (attachments.length > 0) {
            const textBlock = formatTextAttachments(attachments);
            if (textBlock) context = context ? `${textBlock}\n\n${context}` : textBlock;
          }
          // Library auto-context (opt-in via Settings). Embed the user message,
          // retrieve top-3 snippets above cosine 0.65, prepend to context so
          // the chat model can use them. Failures are silent — the chat still
          // sends without library context if embedding hiccups.
          if (libraryAutoContext) {
            try {
              const r = (await chrome.runtime.sendMessage({
                type: 'TOOL_EXEC',
                tool: 'search_library',
                args: { query: prompt, k: 3, threshold: 0.65 },
              })) as { ok: boolean; result: { ok: boolean; data?: { hits: { title: string; source: string; snippet: string }[] } } } | undefined;
              if (r?.ok && r.result.ok && r.result.data?.hits?.length) {
                const hits = r.result.data.hits;
                const block = ['## From your Library:', ...hits.map(
                  (h) => `- **${h.title}** (${h.source}): ${h.snippet.slice(0, 280)}`,
                )].join('\n');
                context = context ? `${block}\n\n${context}` : block;
                // Stash the snippets keyed by the user-message id so the
                // transcript can render the collapsible audit card right
                // beneath the prompt that pulled them in.
                setLibraryHits((prev) => ({ ...prev, [uid]: hits }));
              }
            } catch {
              // Silent — don't block the chat on library hiccups.
            }
          }
          // H4 — stream the reply into a growing bubble. The placeholder agent
          // item is pushed first; each onDelta replaces its text. Falls back to
          // one-shot when chrome.runtime.connect is missing (e.g. unit tests).
          const placeholderId = `a_${seqRef.current++}`;
          setItems((prev) => [...prev, agentItem(placeholderId, '')]);
          const r = await runPlainChat(prompt, {
            context,
            model: activeModel,
            preferNano,
            signal: aborter.signal,
            imageAttachments: imageAttachments(attachments).map((a) => ({
              name: a.name,
              mime: a.mime,
              dataUrl: a.kind === 'image' ? a.dataUrl : '',
            })),
            onDelta: (text) => {
              setItems((prev) =>
                prev.map((it) =>
                  it.kind === 'agent' && it.id === placeholderId ? { ...it, text } : it,
                ),
              );
            },
          });
          if (r.outcome === 'no-key') {
            setNoKey(true);
            // Remove the empty placeholder.
            setItems((prev) => prev.filter((it) => !(it.kind === 'agent' && it.id === placeholderId)));
          } else if (r.outcome === 'aborted') {
            // User clicked Stop: keep whatever streamed so far, append a marker.
            if (!r.text) {
              setItems((prev) => prev.filter((it) => !(it.kind === 'agent' && it.id === placeholderId)));
            }
            setItems((prev) => [...prev, agentItem(`stop_${seqRef.current++}`, '_Stopped by user._')]);
          } else if (r.text) {
            recordCost(r.cost ?? 0);
            // Final state of the bubble (in case onDelta missed the last frame).
            setItems((prev) =>
              prev.map((it) =>
                it.kind === 'agent' && it.id === placeholderId ? { ...it, text: r.text! } : it,
              ),
            );
            void persistRun(
              buildRunRecord({ kind: 'chat', task: prompt, answer: r.text, model: activeModel, startedAt }),
            );
          } else {
            // No content + no no-key — drop the empty placeholder.
            setItems((prev) => prev.filter((it) => !(it.kind === 'agent' && it.id === placeholderId)));
          }
        } else {
          const result = await runAgentTask(prompt, {
            onEvent,
            onConfirm,
            onPlanReview: askBeforePlan ? onPlanReview : undefined,
            onAskUser,
            onHumanGate,
            model: activeModel,
            costBudget: perRunCap,
            stepBudget,
            history: recentHistory(itemsRef.current),
            thinkHarder,
            signal: aborter.signal,
            defaults: { githubRepo: githubDefaultRepo },
          });
          if (result.outcome === 'no-key') setNoKey(true);
          else if (result.outcome === 'cancelled') {
            // User clicked Stop mid-agent-run. The runtime returns the partial
            // state; we surface the stop marker but don't persist as a run.
            setItems((prev) => [...prev, agentItem(`stop_${seqRef.current++}`, '_Stopped by user._')]);
          } else if (result.state) {
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
        // Discard the controller; the Stop button will hide again as busy clears.
        abortRef.current = null;
        setBusy(false);
        // H2: reset the per-turn "Think harder" toggle.
        setThinkHarder(false);
      }
    },
    [busy, mode, attachPage, attachProfile, profiles, activeProfile, activeModel, recordCost, spentToday, perDayCap, perRunCap, stepBudget, askBeforePlan, onPlanReview, onAskUser, onHumanGate, preferNano, attachments, githubDefaultRepo, libraryAutoContext, thinkHarder, visionConfirmAll],
  );

  const decide = useCallback((step: number, callId: string, approved: boolean) => {
    const pending = pendingRef.current;
    const fileTool = pending?.tool === 'write_file' || pending?.tool === 'read_file';
    // File System Access permission resets each session and `requestPermission`
    // needs a user gesture. The Approve click IS that gesture, so re-acquire the
    // root-folder permission HERE (synchronously kicked off) before letting the
    // agent's deferred write/read run — otherwise it would prompt mid-loop with
    // no activation and stall. Started before any await to keep activation live.
    const permP = approved && fileTool ? ensureRootPermission('readwrite') : Promise.resolve(true);
    setItems((prev) => resolveConfirmation(prev, step, callId, approved ? 'approved' : 'denied'));
    if (pending && pending.step === step) {
      pendingRef.current = null;
      void permP.then((granted) => {
        // Deny cleanly if the folder permission couldn't be (re)granted, so the
        // run reports it instead of erroring deep in the write.
        if (approved && fileTool && !granted) pending.resolve({ approved: false });
        else pending.resolve(approved ? { approved: true } : { approved: false });
      });
    }
  }, []);

  // Shared HITL confirm handler: holds the resolver until the user clicks a card.
  const makeOnConfirm = useCallback(
    () =>
      (req: { runId: string; step: number; tool: string; args: Record<string, unknown>; summary: string }) =>
        new Promise<ApprovalDecision>((resolve) => {
          pendingRef.current = { step: req.step, callId: req.summary, tool: req.tool, resolve };
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
            const r = await runPlainChat(fullPrompt, { model: activeModel, preferNano });
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
              onHumanGate,
              model: activeModel,
              costBudget: perRunCap,
              stepBudget,
              defaults: { githubRepo: githubDefaultRepo },
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
    [busy, makeOnConfirm, activeModel, recordCost, perRunCap, stepBudget, askBeforePlan, onPlanReview, onAskUser, onHumanGate, preferNano, githubDefaultRepo],
  );

  // Resume an interrupted run (FR-AGENT-8): reuse the saved plan, skip done steps.
  const resumeRun = useCallback(
    async (cp: RunCheckpoint) => {
      if (busy) return;
      setResumable(null);
      setBusy(true);
      setNoKey(false);
      setItems((prev) => [...prev, userItem(`resume_${seqRef.current++}`, `▶ Resuming: ${cp.task}`)]);
      const onEvent = (e: AgentEvent) => setItems((prev) => reduceTranscript(prev, e));
      try {
        const result = await runAgentTask(cp.task, {
          onEvent,
          onConfirm: makeOnConfirm(),
          onPlanReview: askBeforePlan ? onPlanReview : undefined,
          onAskUser,
          onHumanGate,
          model: activeModel,
          costBudget: perRunCap,
          stepBudget,
          resume: cp.state,
          defaults: { githubRepo: githubDefaultRepo },
        });
        if (result.outcome === 'no-key') setNoKey(true);
        else recordCost(result.state?.costUsed ?? 0);
      } catch (e) {
        setItems((prev) => [...prev, { kind: 'error', id: `rerr_${seqRef.current++}`, text: e instanceof Error ? e.message : String(e) }]);
      } finally {
        pendingRef.current = null;
        setBusy(false);
      }
    },
    [busy, makeOnConfirm, askBeforePlan, onPlanReview, onAskUser, onHumanGate, activeModel, perRunCap, stepBudget, recordCost, githubDefaultRepo],
  );

  const dismissResume = useCallback(() => {
    setResumable(null);
    void clearCheckpoint();
  }, []);

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

  // Keep the view pinned to the latest content as items/cards stream in (so a
  // confirm card's pinned Approve bar lands in view). Two scroll targets are
  // possible: the end sentinel (default — stick to the bottom of the
  // transcript) or the pending-confirm card itself when one exists. We pick
  // the latter when a confirm card is unresolved so back-to-back setItems
  // updates during a live run can't peg the scroll past the card. Earlier,
  // a separate smooth-scroll-to-confirm useEffect fought with the sync
  // scroll-to-bottom here and got clobbered on every status tick — leaving
  // the card rendered behind the fixed banner+composer with empty cream
  // space where its body should have been.
  const pendingConfirm = items.find(
    (it) => it.kind === 'confirm' && it.resolution === undefined,
  );
  useLayoutEffect(() => {
    if (!stickRef.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    if (pendingConfirm) {
      // Deterministic scroll math instead of scrollIntoView + scroll-margin.
      // scroll-margin-bottom is honored unevenly by Chrome when the scroller
      // has padding-bottom + a fixed-positioned footer overlay — the card
      // would end up rendered BEHIND the banner with the body invisible.
      // Compute the target scrollTop directly so the card's BOTTOM sits
      // FIXED_FOOTER_GAP px above the visible bottom edge.
      const card = el.querySelector('.hitl') as HTMLElement | null;
      if (card) {
        const FIXED_FOOTER_GAP = 160; // banner ~50 + composer ~80 + 30 breathing
        const cardRect = card.getBoundingClientRect();
        const scrollerRect = el.getBoundingClientRect();
        // Where is the card's bottom in the scroller's content coords?
        const cardBottomInContent = cardRect.bottom - scrollerRect.top + el.scrollTop;
        // We want it at: el.clientHeight - FIXED_FOOTER_GAP (from the scroller's top).
        const target = cardBottomInContent - (el.clientHeight - FIXED_FOOTER_GAP);
        el.scrollTop = Math.max(0, target);
        return;
      }
    }
    el.scrollTop = el.scrollHeight;
    bottomRef.current?.scrollIntoView({ block: 'end' });
    // We INTENTIONALLY depend on pendingConfirm?.id, not the full object.
    // pendingConfirm is computed fresh on every render (items.find(...)), so
    // including it would re-fire the effect every render. The ID alone
    // captures the meaningful state transition ('new card landed' or
    // 'card was resolved'); the items dep covers content changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, noKey, busy, pendingConfirm?.id]);

  return (
    <div className="chat">
      {artifact && <ArtifactView artifact={artifact} onClose={() => setArtifact(null)} />}
      {chatListOpen && (
        <ConversationList
          conversations={convs}
          activeId={activeChatId}
          onOpen={openConversation}
          onNew={() => {
            startNewChat();
            onCloseChatList?.();
          }}
          onDelete={(id) => void removeConversation(id)}
          onClose={() => onCloseChatList?.()}
        />
      )}
      <div className="chat-scroller" ref={scrollerRef} onScroll={onScrollerScroll}>
        {isEmpty ? (
          <Greeting onPick={setInput} />
        ) : (
          <>
            {items.flatMap((it) => {
              const out = [<TranscriptRow key={it.id} item={it} onDecide={decide} onOpenArtifact={setArtifact} />];
              if (it.kind === 'user' && libraryHits[it.id]?.length) {
                out.push(<LibraryHitsCard key={`${it.id}-lib`} hits={libraryHits[it.id]} />);
              }
              return out;
            })}
            {noKey && <NoKeyNotice />}
            <div ref={bottomRef} aria-hidden="true" />
          </>
        )}
      </div>
      {resumable && !busy && (
        <div className="resume-card" role="group" aria-label="Resume run">
          <div className="resume-card-txt">
            <span className="ic">{Ic.history}</span>
            Resume interrupted run: <strong>{resumable.task}</strong>
            {` (${resumable.state.scratchpad.completedSteps.length}/${resumable.state.scratchpad.plan.length} steps done)`}
          </div>
          <div className="resume-card-actions">
            <button type="button" className="suggest-chip" onClick={dismissResume}>Dismiss</button>
            <button
              type="button"
              className="composer-send"
              style={{ width: 'auto', padding: '0 12px', borderRadius: 8 }}
              aria-label="Resume run"
              onClick={() => void resumeRun(resumable)}
            >
              Resume
            </button>
          </div>
        </div>
      )}
      {humanGate && (
        <div className="human-gate" role="group" aria-label="Human action needed">
          <div className="human-gate-q">
            <span className="ic">{Ic.warn}</span>
            {humanGate.kind === 'captcha'
              ? 'A CAPTCHA / verification challenge is blocking this page. Solve it in the tab, then Resume.'
              : 'A sign-in or 2-factor wall is blocking this page. Sign in in the tab, then Resume.'}
          </div>
          <div className="human-gate-actions">
            <button
              type="button"
              className="composer-send"
              style={{ width: 'auto', padding: '0 12px', borderRadius: 8 }}
              aria-label="Resume"
              onClick={resumeGate}
            >
              Resume
            </button>
          </div>
        </div>
      )}
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
      {mode === 'voice' && (
        <VoiceControls
          state={voiceState}
          error={voiceError}
          flow={voiceFlow}
          onStart={() => void startVoice()}
          onStop={() => void stopVoice()}
        />
      )}
      {pendingConfirm && (
        <button
          type="button"
          className="pending-confirm-bar"
          data-testid="pending-confirm-banner"
          onClick={() => {
            const el = scrollerRef.current?.querySelector('.hitl');
            if (el && 'scrollIntoView' in el) {
              // block:'end' lands the Approve/Cancel row above the banner
              // itself (scroll-margin-bottom on .hitl handles the offset).
              (el as HTMLElement).scrollIntoView({ block: 'end', behavior: 'smooth' });
            }
          }}
          aria-label="Buddy is waiting for your confirmation — scroll to the confirm card"
        >
          <span className="ic">{Ic.warn}</span>
          <span>Buddy is waiting for you to approve a {pendingConfirm.kind === 'confirm' ? pendingConfirm.call.name : 'action'} call</span>
          <span className="pending-confirm-bar-cta">↑ Scroll</span>
        </button>
      )}
      <ChatComposer
        input={input}
        onChange={setInput}
        onSend={() => void submit(input)}
        onStop={() => abortRef.current?.abort()}
        busy={busy}
        mode={mode}
        onMode={setMode}
        attachPage={attachPage}
        onAttachPage={() => setAttachPage(!attachPage)}
        thinkHarder={thinkHarder}
        onThinkHarder={() => setThinkHarder((v) => !v)}
        sessionCost={sessionCost}
        attachments={attachments}
        attachError={attachError}
        onPickFiles={async (files) => {
          setAttachError(null);
          const picked: ChatAttachment[] = [];
          for (const f of files) {
            if (attachments.length + picked.length >= MAX_ATTACHMENTS) {
              setAttachError(`Up to ${MAX_ATTACHMENTS} attachments per message.`);
              break;
            }
            const klass = classifyFile(f);
            if (klass.kind === 'reject') {
              setAttachError(klass.reason);
              continue;
            }
            if (klass.kind === 'image') {
              const dataUrl = await readAsDataURL(f);
              picked.push({ kind: 'image', name: f.name, mime: f.type, dataUrl, size: f.size });
            } else {
              const text = await readAsText(f);
              picked.push({ kind: 'text', name: f.name, mime: f.type || 'text/plain', text, size: f.size });
            }
          }
          if (picked.length === 0) return;
          const next = [...attachments, ...picked];
          if (totalBytes(next) > MAX_TOTAL_BYTES) {
            setAttachError(`Total attachment size exceeds ${formatBytes(MAX_TOTAL_BYTES)}.`);
            return;
          }
          setAttachments(next);
        }}
        onRemoveAttachment={(i) => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
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

/** Collapsible "From your Library" card — surfaced when auto-context
 *  injected snippets into the current chat turn. Folds closed by default;
 *  expand to read the actual chunks that went into the LLM prompt. */
function LibraryHitsCard({ hits }: { hits: LibraryAutoContextHit[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lib-ctx-card" data-testid="lib-ctx-card">
      <button
        type="button"
        className="lib-ctx-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ic" style={{ width: 12, height: 12 }}>{Ic.library}</span>
        <span className="lib-ctx-label">
          Used {hits.length} snippet{hits.length === 1 ? '' : 's'} from your Library
        </span>
        <span className="lib-ctx-caret">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="lib-ctx-list">
          {hits.map((h, i) => (
            <div key={i} className="lib-ctx-hit">
              <div className="lib-ctx-hit-hd">
                <span className={'library-source library-source-' + h.source}>{h.source}</span>
                <span className="lib-ctx-hit-title" title={h.title}>{h.title}</span>
              </div>
              <div className="lib-ctx-hit-snippet">{h.snippet}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** "+ Library" button on a Buddy reply. Opens an inline title input; on
 *  Save, sends LIBRARY_INDEX (source 'manual') and flips to "Saved ✓". */
function SaveToLibraryButton({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(() => deriveSaveTitle(text));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | undefined>();
  if (!text?.trim()) return null;
  const onSave = async () => {
    setError(undefined);
    setSaving(true);
    try {
      const r = (await chrome.runtime.sendMessage({
        type: 'LIBRARY_INDEX',
        source: 'manual',
        sourceRef: `chat-save-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: title.trim() || 'Saved reply',
        content: text,
      })) as { ok: boolean; result: { ok: boolean; error?: { message: string } } } | undefined;
      if (r?.ok && r.result.ok) {
        setSaved(true);
        window.setTimeout(() => { setOpen(false); setSaved(false); }, 1400);
      } else {
        setError(r?.result.error?.message ?? 'Save failed.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  if (!open) {
    return (
      <button
        type="button"
        className="msg-action-btn"
        title="Save this reply to your Library so you can search it later."
        data-testid="msg-save-library"
        onClick={() => setOpen(true)}
      >
        <span className="ic" style={{ width: 12, height: 12 }}>{Ic.library}</span>
        <span>+ Library</span>
      </button>
    );
  }
  return (
    <div className="msg-save-form" data-testid="msg-save-form">
      <input
        type="text"
        className="settings-input msg-save-title"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void onSave(); if (e.key === 'Escape') setOpen(false); }}
        aria-label="Title for the saved Library entry"
        autoFocus
      />
      <button type="button" className="btn btn-sm btn-primary" onClick={onSave} disabled={saving || !title.trim()} data-testid="msg-save-confirm">
        {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
      </button>
      <button type="button" className="btn btn-sm" onClick={() => setOpen(false)} disabled={saving}>
        Cancel
      </button>
      {error && <span className="msg-save-err">{error}</span>}
    </div>
  );
}

/** Derive a default save-title from the first non-empty line of the reply. */
function deriveSaveTitle(text: string): string {
  const first = (text ?? '').split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? 'Saved reply';
  return first.replace(/^#+\s*/, '').slice(0, 80);
}

/** Voice mode control strip — sits above the composer when mode === 'voice'.
 *  Owns the start/stop button + state pill; the actual mic + WebSocket are
 *  in src/voice/liveSession.ts (panel side) and src/background/live.ts (SW). */
function VoiceControls({
  state,
  error,
  flow,
  onStart,
  onStop,
}: {
  state: 'idle' | 'connecting' | 'live' | 'error';
  error?: string;
  flow?: { sent: number; sentB: number; recv: number; recvB: number; played: number };
  onStart: () => void;
  onStop: () => void;
}) {
  const supported = isVoiceSupported();
  const isOn = state === 'live' || state === 'connecting';
  return (
    <div className="voice-controls" data-testid="voice-controls">
      <button
        type="button"
        className={'voice-btn' + (isOn ? ' is-on' : '')}
        onClick={isOn ? onStop : onStart}
        disabled={!supported}
        data-testid={isOn ? 'voice-stop' : 'voice-start'}
        title={
          !supported
            ? 'Voice mode requires getUserMedia + WebSocket (unavailable in this context).'
            : isOn
              ? 'Stop the voice session.'
              : 'Start a voice session — Buddy listens and talks back.'
        }
      >
        <span className="ic">{isOn ? Ic.stop : Ic.mic}</span>
        <span>{isOn ? 'Stop voice' : 'Start voice'}</span>
      </button>
      <span className={'voice-state voice-state-' + state}>
        {!supported
          ? 'Voice unavailable'
          : state === 'connecting'
            ? 'Connecting…'
            : state === 'live'
              ? '● Live — speak naturally'
              : state === 'error'
                ? error ?? 'Voice error'
                : 'Idle'}
      </span>
      {isOn && flow && (
        <span className="voice-flow" data-testid="voice-flow" title="Live audio counters — proves bytes are flowing in both directions.">
          <span className="voice-flow-up" title={`${flow.sentB} bytes sent`}>↑ {flow.sent}</span>
          <span className="voice-flow-down" title={`${flow.recvB} bytes received · ${flow.played} chunks played`}>↓ {flow.recv}</span>
        </span>
      )}
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
            <div className="msg-actions">
              <SpeakButton text={item.text} />
              <SaveToLibraryButton text={item.text} />
            </div>
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
  const allEntries = Object.entries(item.call.arguments);
  // Pull out the safety_decision (if any) for a dedicated explainer block;
  // remaining entries render below as usual. Computer-use.md L584-618.
  const sd = (item.call.arguments as { safety_decision?: { decision?: string; explanation?: string } })
    .safety_decision;
  const entries = allEntries.filter(([k]) => k !== 'safety_decision');
  return (
    <div className="hitl" role="group" aria-label="Confirmation required">
      <div className="hitl-hd">
        <span className="hitl-ic">
          <span className="ic">{Ic.warn}</span>
        </span>
        <span className="hitl-title">
          {sd?.decision === 'require_confirmation' ? 'Safety check — confirm to continue' : 'Confirm this action'}
        </span>
        <span className="hitl-tag">{resolved ? item.resolution : sd?.decision === 'require_confirmation' ? 'safety' : 'review'}</span>
      </div>
      <div className="hitl-body">
        {sd?.explanation && (
          <div className="hitl-safety">
            <span className="hitl-safety-label">Why:</span> {sd.explanation}
          </div>
        )}
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
  { v: 'vision', l: 'Vision', title: "Vision: Buddy SEES the active tab and drives it click-by-click (Gemini Computer Use). Slower + costlier — use for visual tasks our DOM agent can't handle." },
  { v: 'voice', l: 'Voice', title: 'Voice: real-time bidirectional voice chat with Buddy via Gemini Live (mic + speaker).' },
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

// Slide-over conversation list (chat history): open / delete / new.
function ConversationList({
  conversations,
  activeId,
  onOpen,
  onNew,
  onDelete,
  onClose,
}: {
  conversations: Conversation[] | null;
  activeId: string;
  onOpen: (c: Conversation) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const snippet = (c: Conversation): string => {
    const lastAgent = [...c.items].reverse().find((i) => i.kind === 'agent');
    const t = lastAgent && lastAgent.kind === 'agent' ? lastAgent.text : '';
    return t.replace(/\s+/g, ' ').slice(0, 60);
  };
  return (
    <div className="chats-over" role="dialog" aria-label="Chats">
      <div className="chats-over-hd">
        <span className="chats-over-title">Chats</span>
        <button type="button" className="composer-mic" aria-label="Close chats" onClick={onClose}>
          <span className="ic">{Ic.x}</span>
        </button>
      </div>
      <button type="button" className="chats-new" onClick={onNew}>
        <span className="ic">{Ic.plus}</span> New chat
      </button>
      <div className="chats-list">
        {conversations === null ? null : conversations.length === 0 ? (
          <div className="empty-state-desc" style={{ padding: '12px' }}>No saved chats yet.</div>
        ) : (
          conversations.map((c) => (
            <div key={c.id} className={'chats-row' + (c.id === activeId ? ' is-active' : '')}>
              <button type="button" className="chats-row-main" onClick={() => onOpen(c)}>
                <div className="chats-row-title">{c.title}</div>
                <div className="chats-row-sub">{snippet(c) || `${c.items.length} message(s)`} · {chatTimeAgo(c.updatedAt)}</div>
              </button>
              <button type="button" className="chats-row-del" aria-label={`Delete ${c.title}`} onClick={() => onDelete(c.id)}>✕</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function chatTimeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function ChatComposer({
  input,
  onChange,
  onSend,
  onStop,
  busy,
  mode,
  onMode,
  attachPage,
  onAttachPage,
  thinkHarder,
  onThinkHarder,
  sessionCost,
  attachments,
  attachError,
  onPickFiles,
  onRemoveAttachment,
}: {
  input: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop?: () => void;
  busy: boolean;
  mode: ChatMode;
  onMode: (m: ChatMode) => void;
  attachPage: boolean;
  onAttachPage: () => void;
  thinkHarder: boolean;
  onThinkHarder: () => void;
  sessionCost: number;
  attachments: ChatAttachment[];
  attachError: string | null;
  onPickFiles: (files: File[]) => Promise<void>;
  onRemoveAttachment: (index: number) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Auto-grow the textarea as content gets taller, capped by CSS max-height
  // (50vh). Past the cap the textarea scrolls. Resetting height to 'auto'
  // first so shrinking after a delete also lays out correctly.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [input]);
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
      {(attachments.length > 0 || attachError) && (
        <div className="composer-attachments" data-testid="composer-attachments">
          {attachments.map((a, i) => (
            <span key={i} className={`attach-chip is-${a.kind}`} title={`${a.mime || a.kind} · ${formatBytes(a.size)}`}>
              <span className="attach-chip-icon">{a.kind === 'image' ? Ic.image : Ic.attach}</span>
              <span className="attach-chip-name">{a.name}</span>
              <span className="attach-chip-size">{formatBytes(a.size)}</span>
              <button
                type="button"
                className="attach-chip-x"
                aria-label={`Remove ${a.name}`}
                onClick={() => onRemoveAttachment(i)}
              >
                ✕
              </button>
            </span>
          ))}
          {attachError && <span className="attach-error">{attachError}</span>}
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,.txt,.md,.markdown,.json,.csv,.tsv,.yaml,.yml,.xml,.html,.htm,.log,.ini,.toml,.env,.js,.ts,.tsx,.jsx,.css,.sql,.sh,.py,.rb,.go,.rs,.java,.c,.h,.cpp,.rst,.org,.tex"
        multiple
        style={{ display: 'none' }}
        data-testid="composer-file-input"
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          // Reset the input so picking the same file twice still fires onChange.
          e.target.value = '';
          if (files.length === 0) return;
          await onPickFiles(files);
        }}
      />
      <div className="composer-bar">
        <button
          type="button"
          className="composer-attach"
          aria-label="Attach file"
          title="Attach an image or text file"
          onClick={() => fileInputRef.current?.click()}
          data-testid="composer-attach"
        >
          <span className="ic">{Ic.attach}</span>
        </button>
        <textarea
          ref={textareaRef}
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
        {busy ? (
          <button
            type="button"
            className="composer-send composer-stop"
            aria-label="Stop"
            data-testid="chat-stop"
            onClick={onStop}
            title="Stop generating"
          >
            <span className="ic">{Ic.stop}</span>
          </button>
        ) : (
          <button
            type="button"
            className="composer-send"
            aria-label="Send"
            disabled={!input.trim()}
            onClick={onSend}
          >
            <span className="ic">{Ic.send}</span>
          </button>
        )}
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
            className={'ctx-chip' + (thinkHarder ? ' is-on' : '')}
            onClick={onThinkHarder}
            aria-pressed={thinkHarder}
            title={
              thinkHarder
                ? 'Synthesis will run at thinking:high for this turn'
                : 'Toggle deeper reasoning for the next turn'
            }
          >
            <span className="ctx-chip-ic">{Ic.sparkle}</span>
            Think harder
          </button>
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

/** Read a File as a base64 data URL (image attachments). The result is the
 *  raw `data:<mime>;base64,<…>` string that the OpenAI-compat adapter passes
 *  through unchanged as an image_url part. */
function readAsDataURL(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('FileReader failed'));
    r.readAsDataURL(f);
  });
}

/** Read a File as UTF-8 text (text-file attachments). */
function readAsText(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('FileReader failed'));
    r.readAsText(f);
  });
}
