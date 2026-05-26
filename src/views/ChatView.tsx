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
  const [activeModel] = useActiveModel();
  const [sessionCost, setSessionCost] = useState(0);
  const [perRunCap] = usePersistedState<number>(BUDGET_KEYS.perRun, BUDGET_DEFAULTS.perRun);
  const [perDayCap] = usePersistedState<number>(BUDGET_KEYS.perDay, BUDGET_DEFAULTS.perDay);
  const [stepBudget] = usePersistedState<number>(BUDGET_KEYS.steps, BUDGET_DEFAULTS.steps);
  const [spentToday, setSpentToday] = useState(0);
  const [askBeforePlan] = usePersistedState<boolean>('askBeforePlan', true);
  const [preferNano] = usePersistedState<boolean>('preferNano', false);
  const [libraryAutoContext] = usePersistedState<boolean>('libraryAutoContext', false);
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
                const block = ['## From your Library:', ...r.result.data.hits.map(
                  (h) => `- **${h.title}** (${h.source}): ${h.snippet.slice(0, 280)}`,
                )].join('\n');
                context = context ? `${block}\n\n${context}` : block;
                // Transparency: surface what we used so the user can audit it.
                setItems((prev) => [
                  ...prev,
                  agentItem(`lib_${seqRef.current++}`, `_Used ${r.result.data!.hits.length} snippet(s) from your Library._`),
                ]);
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
        // H2: reset the per-turn "Think harder" toggle.
        setThinkHarder(false);
      }
    },
    [busy, mode, attachPage, attachProfile, profiles, activeProfile, activeModel, recordCost, spentToday, perDayCap, perRunCap, stepBudget, askBeforePlan, onPlanReview, onAskUser, onHumanGate, preferNano],
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
    [busy, makeOnConfirm, activeModel, recordCost, perRunCap, stepBudget, askBeforePlan, onPlanReview, onAskUser, onHumanGate, preferNano],
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
    [busy, makeOnConfirm, askBeforePlan, onPlanReview, onAskUser, onHumanGate, activeModel, perRunCap, stepBudget, recordCost],
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
  // confirm card's pinned Approve bar lands in view). Scrolling the end sentinel
  // is more reliable than scrollTop math when a tall card is the last child.
  useLayoutEffect(() => {
    if (!stickRef.current) return;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [items, noKey, busy]);

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
            {items.map((it) => (
              <TranscriptRow key={it.id} item={it} onDecide={decide} onOpenArtifact={setArtifact} />
            ))}
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
      <ChatComposer
        input={input}
        onChange={setInput}
        onSend={() => void submit(input)}
        busy={busy}
        mode={mode}
        onMode={setMode}
        attachPage={attachPage}
        onAttachPage={() => setAttachPage(!attachPage)}
        thinkHarder={thinkHarder}
        onThinkHarder={() => setThinkHarder((v) => !v)}
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
  busy,
  mode,
  onMode,
  attachPage,
  onAttachPage,
  thinkHarder,
  onThinkHarder,
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
  thinkHarder: boolean;
  onThinkHarder: () => void;
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
