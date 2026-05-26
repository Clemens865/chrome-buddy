// Background service worker (MV3).
//
// Two jobs:
//   1. Open the side panel on toolbar-action click (unchanged from v0).
//   2. Own API-key custody and ALL cloud LLM calls (PRD NFR-SEC-1/2):
//      - Keys live ONLY in chrome.storage.session (in-memory; cleared when the
//        browser session ends). They are never persisted to disk and never
//        returned to a caller.
//      - LLM_GENERATE runs the LlmClient HERE, using the stored key, so the key
//        never reaches a content script or page context.
//
// The message protocol lives in src/key/messages.ts; the client wiring in
// src/llm/instance.ts.

import {
  apiKeyStorageKey,
  isBuddyMessage,
  type BuddyMessage,
  type BuddyResponse,
} from '../key/messages';
import { getLlmClient, resolveProviderId, readSessionApiKey, refreshEffectiveRegistry, currentRegistry } from '../llm/instance';
import { estimateCost } from '../llm/router';
import { USER_REGISTRY_KEY } from '../llm/userRegistry';
import { updateRemoteRegistry } from '../llm/remoteRegistry';
import { LlmClient } from '../llm/client';
import { DEFAULT_REGISTRY } from '../llm/registry.default';
import { safetySettingsForNative } from '../llm/safety';
import { BUDDY_UA } from '../llm/ua';
import { retryFetch } from '../llm/retry';
import { executePageTool, capturePageContext, resolveActiveTabId } from './pageTools';
import { executeWebhook, executeListWebhooks } from './webhook';
import { executeWebSearch } from './search';
import { executeFetchUrl } from './urlContext';
import { executeFileSearch } from './fileSearch';
import { executeGithubWrite, executeGithubRead, executeGithubList } from './github';
import { executeVisionTurn, executeVisionAction, captureActiveTabPNG } from './vision';
import { executeFileWrite } from './fileWrite';
import {
  executeWebVitals,
  executeReadNetwork,
  executeScanSecurity,
  executeAnalyzeErrors,
  executeReadStorage,
  executeScanSensitive,
  executeDetectTechStack,
  executeAnalyzeA11y,
  executeAnalyzeSeo,
} from './inspector';
import { executeSearchLibrary, executeIndexDoc, executeLibraryBackfill } from './library';
import { registerVoiceStreamPort, type LiveFunctionDeclaration } from './live';
import { stubToolDefs } from '../tools/defs';
import { saveRun, listRuns, clearRuns } from '../memory/store';
import { saveSkill, listSkills, deleteSkill } from '../skills/store';
import { saveWorkflow, listWorkflows, deleteWorkflow } from '../workflows/store';
import { saveApp, listApps, deleteApp } from '../apps/store';
import {
  alarmSpecsFor,
  workflowIdFromAlarm,
  DUE_WORKFLOWS_KEY,
} from '../workflows/schedule';
import { matchesEventTrigger } from '../workflows/build';

// NFR-SEC-1: keep session storage (where the API key lives) unreadable from
// content scripts / page contexts. TRUSTED_CONTEXTS is the MV3 default, but we
// set it explicitly so the key custody guarantee doesn't depend on a default.
chrome.storage?.session
  ?.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })
  .catch(() => {});

// Load the effective model registry (bundled + remote + user overlay) and keep
// it fresh when the user edits it or a verified remote update lands (FR-MR-1/5/8).
const REGISTRY_POLL_ALARM = 'registry-poll';
async function pollRemoteRegistry(): Promise<void> {
  await updateRemoteRegistry(); // verifies signature; keeps last-good on failure
  await refreshEffectiveRegistry();
}
void refreshEffectiveRegistry().then(() => void pollRemoteRegistry());
chrome.alarms?.create?.(REGISTRY_POLL_ALARM, { periodInMinutes: 1440 }); // daily (FR-MR-5)
chrome.storage?.onChanged?.addListener((changes, areaName) => {
  if (areaName === 'local' && USER_REGISTRY_KEY in changes) void refreshEffectiveRegistry();
});

chrome.runtime.onInstalled.addListener(() => {
  // Allow clicking the toolbar icon to toggle the side panel open.
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('[chrome-buddy] setPanelBehavior failed', err));
});

/**
 * Generate an image via Gemini's NATIVE generateContent endpoint
 * (responseModalities: IMAGE). Image models can't go through the OpenAI-compatible
 * chat adapter, so this calls the native endpoint directly and parses the inline
 * image bytes. The key stays in the SW.
 */
async function generateImageNative(
  providerId: string,
  model: string,
  prompt: string,
  inputImage?: string,
): Promise<BuddyResponse> {
  const key = await getStoredKey(providerId);
  if (!key) return { type: 'ERROR', ok: false, error: `No API key set for provider '${providerId}'.` };

  const provider = DEFAULT_REGISTRY.providers[providerId];
  // Derive the native base from the OpenAI-compat base by stripping /openai.
  const base =
    (provider?.baseUrl ?? '').replace(/\/openai\/?$/, '') ||
    'https://generativelanguage.googleapis.com/v1beta';
  const url = `${base}/models/${model}:generateContent`;

  const parts: Record<string, unknown>[] = [{ text: prompt }];
  if (inputImage) {
    const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(inputImage);
    if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
  }

  // Aspect ratio is conveyed via the prompt text (generation_config.response_format
  // .image.aspect_ratio is rejected by this endpoint), so we only set the modality.
  const generationConfig: Record<string, unknown> = { responseModalities: ['IMAGE'] };

  let resp: Response;
  try {
    resp = await retryFetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': key,
        'x-goog-api-client': BUDDY_UA,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig,
        safetySettings: safetySettingsForNative(),
      }),
    });
  } catch (err) {
    return { type: 'ERROR', ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    return { type: 'ERROR', ok: false, error: `Image API ${resp.status}: ${body.slice(0, 300)}` };
  }

  const data = (await resp.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
  };
  const respParts = data.candidates?.[0]?.content?.parts ?? [];
  for (const p of respParts) {
    const inline = p.inlineData;
    if (inline?.data) {
      const mime = inline.mimeType ?? 'image/png';
      return { type: 'IMAGE_GENERATE', ok: true, dataUrl: `data:${mime};base64,${inline.data}` };
    }
  }
  return { type: 'ERROR', ok: false, error: 'The model did not return an image.' };
}

/**
 * Transcribe audio via the native Gemini generateContent endpoint: send the
 * audio as inlineData with a transcription instruction, return the text parts.
 * Mirrors generateImageNative (same key custody, same base-URL derivation).
 */
async function transcribeAudioNative(
  providerId: string,
  model: string,
  audioBase64: string,
  mimeType: string,
  prompt: string,
): Promise<BuddyResponse> {
  const key = await getStoredKey(providerId);
  if (!key) return { type: 'ERROR', ok: false, error: `No API key set for provider '${providerId}'.` };

  const provider = DEFAULT_REGISTRY.providers[providerId];
  const base =
    (provider?.baseUrl ?? '').replace(/\/openai\/?$/, '') ||
    'https://generativelanguage.googleapis.com/v1beta';
  const url = `${base}/models/${model}:generateContent`;

  const parts = [{ text: prompt }, { inlineData: { mimeType, data: audioBase64 } }];

  let resp: Response;
  try {
    resp = await retryFetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': key,
        'x-goog-api-client': BUDDY_UA,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        safetySettings: safetySettingsForNative(),
      }),
    });
  } catch (err) {
    return { type: 'ERROR', ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    return { type: 'ERROR', ok: false, error: `Audio API ${resp.status}: ${body.slice(0, 300)}` };
  }

  const data = (await resp.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  if (!text) return { type: 'ERROR', ok: false, error: 'The model returned no transcript.' };
  return { type: 'AUDIO_TRANSCRIBE', ok: true, text };
}

/**
 * Resolve a provider's key: in-app key (storage.session) → DEV .env fallback.
 * Delegates to the single resolver in instance.ts so KEY_STATUS, LLM_GENERATE
 * and IMAGE_GENERATE all honor the same lookup.
 */
async function getStoredKey(provider: string): Promise<string | undefined> {
  return readSessionApiKey(provider);
}

/**
 * Tool-name → handler map for TOOL_EXEC routing. Replaces the previous 17-deep
 * if/else chain; new tools just add a row here. Handlers that need the API key
 * receive `getStoredKey`; handlers that don't ignore the second arg.
 *
 * SECURITY: this is the SW-side dispatch. Consequential tools (send_webhook,
 * write_file) only reach this map AFTER the runtime's HITL gate approved them
 * in the UI — see src/agent/runner.ts.
 */
type ToolHandler = (
  args: Record<string, unknown>,
  getKey: typeof getStoredKey,
) => Promise<import('../types').ToolResult>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  // Consequential (HITL-gated upstream) — SW just performs.
  send_webhook: (a) => executeWebhook(a),
  write_file: (a) => executeFileWrite(a),
  // Network/search built-ins (need the API key).
  search_web: (a, k) => executeWebSearch(a, k),
  fetch_url: (a, k) => executeFetchUrl(a, k),
  file_search: (a, k) => executeFileSearch(a, k),
  // GitHub Contents API (uses the stored PAT internally).
  github_write: (a) => executeGithubWrite(a),
  github_read: (a) => executeGithubRead(a),
  github_list: (a) => executeGithubList(a),
  // Console Inspector — Tier 1 + Tier 2.
  analyze_errors: (a) => executeAnalyzeErrors(a),
  web_vitals: () => executeWebVitals(),
  read_network: (a) => executeReadNetwork(a),
  scan_security: () => executeScanSecurity(),
  read_storage: (a) => executeReadStorage(a),
  scan_sensitive_data: () => executeScanSensitive(),
  detect_tech_stack: () => executeDetectTechStack(),
  analyze_a11y: () => executeAnalyzeA11y(),
  analyze_seo: () => executeAnalyzeSeo(),
  // Library RAG (local IDB index, Gemini embeddings).
  search_library: (a, k) => executeSearchLibrary(a, k),
  // Webhook address book — paired with send_webhook (consequential, already
  // in the map above as a 'consequential / HITL-gated upstream' entry).
  list_webhooks: () => executeListWebhooks(),
};

/**
 * Voice-mode tool subset. Includes:
 *  - Page driving (navigate / click / type / scroll / read_dom / extract /
 *    screenshot / summarize) so Buddy can actually browse on voice commands.
 *  - Read/search/analytical tools (library, vitals, errors, SEO, etc.).
 *  - Excludes ALL consequential tools (send_webhook, write_file, github_write):
 *    the voice path has no HITL gate; until we wire verbal/inline confirmation,
 *    only non-consequential tools are voice-callable.
 *
 * The model still respects restricted-URL guards inside executePageTool, so
 * "navigate to chrome://" etc. fail cleanly with a structured error.
 */
const VOICE_TOOL_NAMES: ReadonlySet<string> = new Set([
  // Page driving (DOM-first via executePageTool).
  'navigate',
  'click',
  'type',
  'scroll',
  'read_dom',
  'extract',
  'screenshot',
  'summarize',
  // Analysis + search (already wired in TOOL_HANDLERS).
  'search_library',
  'list_webhooks',
  'web_vitals',
  'scan_security',
  'detect_tech_stack',
  'analyze_a11y',
  'analyze_seo',
  'analyze_errors',
  'read_network',
  'read_storage',
  'scan_sensitive_data',
  'fetch_url',
  'search_web',
  'file_search',
]);

/** PAGE_TOOLS fall through to executePageTool rather than living in
 *  TOOL_HANDLERS. We synthesise voice handlers for them so the Live dispatch
 *  loop can resolve them by name. */
const PAGE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'navigate', 'click', 'type', 'scroll', 'read_dom', 'extract', 'screenshot', 'summarize',
]);

/** Default model for audio transcription (audio-understanding capable). */
const TRANSCRIBE_MODEL = 'gemini-2.5-flash';
const TRANSCRIBE_PROMPT =
  'Transcribe this audio verbatim into plain text. Output only the transcript, no commentary.';

/**
 * Handle one inbound message and produce a response. Exported (and pure w.r.t.
 * the chrome.* it touches) so it is unit-testable with mocked chrome.* APIs.
 */
export async function handleBuddyMessage(message: BuddyMessage): Promise<BuddyResponse> {
  try {
    switch (message.type) {
      case 'KEY_SET': {
        // NFR-SEC-1: keys live ONLY in chrome.storage.session (in-memory, cleared
        // when the browser session ends) — never storage.local/sync/disk.
        const store = chrome.storage?.session;
        const storageKey = apiKeyStorageKey(message.provider);
        if (message.key.length === 0) {
          await store?.remove(storageKey);
        } else {
          await store?.set({ [storageKey]: message.key });
        }
        return { type: 'KEY_SET', ok: true };
      }

      case 'KEY_STATUS': {
        const key = await getStoredKey(message.provider);
        // SECURITY: report existence only — never echo the key itself.
        return { type: 'KEY_STATUS', hasKey: key !== undefined };
      }

      case 'KEY_VALIDATE': {
        // Build a one-off client that uses the CANDIDATE key (not the stored
        // one) and make a tiny request. Nothing is persisted.
        const client = new LlmClient(DEFAULT_REGISTRY, async () => message.key);
        try {
          await client.generate({
            messages: [{ role: 'user', content: 'ping' }],
            params: { maxOutputTokens: 1 },
          });
          return { type: 'KEY_VALIDATE', ok: true };
        } catch (err) {
          return {
            type: 'KEY_VALIDATE',
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      case 'LLM_GENERATE': {
        const providerId = resolveProviderId(message.model);
        if (!providerId) {
          return { type: 'ERROR', ok: false, error: 'Unknown or disabled model.' };
        }
        const key = await getStoredKey(providerId);
        if (!key) {
          return {
            type: 'ERROR',
            ok: false,
            error: `No API key set for provider '${providerId}'.`,
          };
        }
        const client = getLlmClient(providerId);
        const result = await client.generate({
          model: message.model,
          messages: message.messages,
          tools: message.tools,
          params: message.params,
        });
        return { type: 'LLM_GENERATE', ok: true, result };
      }

      case 'TOOL_EXEC': {
        // Look up the handler in the dispatch map; fall back to executePageTool
        // for DOM-first page tools (navigate, click, type, scroll, read_dom,
        // extract, screenshot, summarize). Restricted URLs are refused inside
        // executePageTool with a structured error.
        const handler = TOOL_HANDLERS[message.tool];
        const result = handler
          ? await handler(message.args, getStoredKey)
          : await executePageTool(message.tool, message.args);
        return { type: 'TOOL_EXEC', ok: true, result };
      }

      case 'PAGE_CONTEXT': {
        const page = await capturePageContext();
        return { type: 'PAGE_CONTEXT', ok: true, page };
      }

      case 'VISION_TURN': {
        const r = await executeVisionTurn(message.contents, getStoredKey);
        return {
          type: 'VISION_TURN',
          ok: true,
          text: r.text,
          functionCalls: r.functionCalls,
          modelTurn: r.modelTurn,
          usage: r.usage,
        };
      }

      case 'VISION_ACTION': {
        const r = await executeVisionAction(message.tabId, message.call);
        return { type: 'VISION_ACTION', ...r };
      }

      case 'VISION_CAPTURE': {
        // Resolve the active driveable (http(s)) tab — never the panel itself
        // (chrome-extension:// can't be captured) — using the shared helper that
        // falls back to any web tab when the side panel is focused.
        const tabId = message.tabId ?? (await resolveActiveTabId());
        if (typeof tabId !== 'number') {
          return { type: 'VISION_CAPTURE', ok: false, error: 'No driveable web tab to capture. Open the site in a regular tab first.' };
        }
        try {
          const cap = await captureActiveTabPNG(tabId);
          return { type: 'VISION_CAPTURE', ok: true, tabId, screenshot: cap.data, url: cap.url, title: cap.title };
        } catch (e) {
          return { type: 'VISION_CAPTURE', ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      }

      case 'MEMORY_SAVE_RUN': {
        await saveRun(message.run);
        return { type: 'MEMORY_SAVE_RUN', ok: true };
      }

      case 'MEMORY_LIST_RUNS': {
        const runs = await listRuns(message.limit);
        return { type: 'MEMORY_LIST_RUNS', ok: true, runs };
      }

      case 'MEMORY_CLEAR': {
        await clearRuns();
        return { type: 'MEMORY_CLEAR', ok: true };
      }

      case 'SKILL_SAVE': {
        await saveSkill(message.skill);
        return { type: 'SKILL_SAVE', ok: true };
      }

      case 'SKILL_LIST': {
        return { type: 'SKILL_LIST', ok: true, skills: await listSkills() };
      }

      case 'SKILL_DELETE': {
        await deleteSkill(message.id);
        return { type: 'SKILL_DELETE', ok: true };
      }

      case 'WORKFLOW_SAVE': {
        await saveWorkflow(message.workflow);
        await reconcileWorkflowAlarms();
        return { type: 'WORKFLOW_SAVE', ok: true };
      }

      case 'WORKFLOW_LIST': {
        return { type: 'WORKFLOW_LIST', ok: true, workflows: await listWorkflows() };
      }

      case 'WORKFLOW_DELETE': {
        await deleteWorkflow(message.id);
        await reconcileWorkflowAlarms();
        return { type: 'WORKFLOW_DELETE', ok: true };
      }

      case 'APP_SAVE': {
        await saveApp(message.app);
        return { type: 'APP_SAVE', ok: true };
      }

      case 'APP_LIST': {
        return { type: 'APP_LIST', ok: true, apps: await listApps() };
      }

      case 'APP_DELETE': {
        await deleteApp(message.id);
        return { type: 'APP_DELETE', ok: true };
      }

      case 'LIBRARY_INDEX': {
        // Used by the chat auto-mirror, the note auto-mirror, the folder
        // import flow, and the e2e tests. Each call chunks, embeds (Gemini),
        // and stores one doc atomically.
        const result = await executeIndexDoc(
          {
            source: message.source,
            sourceRef: message.sourceRef,
            title: message.title,
            content: message.content,
          },
          getStoredKey,
        );
        return { type: 'LIBRARY_INDEX', ok: true, result };
      }

      case 'LIBRARY_BACKFILL': {
        // One-time walk over existing chats + notes; idempotent on re-run.
        const r = await executeLibraryBackfill(getStoredKey);
        return { type: 'LIBRARY_BACKFILL', ok: true, ...r };
      }

      case 'IMAGE_GENERATE': {
        const providerId = resolveProviderId(message.model);
        if (!providerId) {
          return { type: 'ERROR', ok: false, error: 'Unknown or disabled model.' };
        }
        const key = await getStoredKey(providerId);
        if (!key) {
          return { type: 'ERROR', ok: false, error: `No API key set for provider '${providerId}'.` };
        }
        return generateImageNative(providerId, message.model, message.prompt, message.inputImage);
      }

      case 'AUDIO_TRANSCRIBE': {
        const model = message.model ?? TRANSCRIBE_MODEL;
        const providerId = resolveProviderId(model);
        if (!providerId) return { type: 'ERROR', ok: false, error: 'Unknown or disabled model.' };
        return transcribeAudioNative(
          providerId,
          model,
          message.audioBase64,
          message.mimeType,
          message.prompt ?? TRANSCRIBE_PROMPT,
        );
      }

      default: {
        const exhaustive: never = message;
        return { type: 'ERROR', ok: false, error: `Unhandled message: ${String(exhaustive)}` };
      }
    }
  } catch (err) {
    return { type: 'ERROR', ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Reconcile chrome.alarms with the current scheduled workflows: clear any of
 * our `wf:` alarms, then (re)create one per scheduled workflow. Cheap and
 * idempotent — safe to call on startup and after every save/delete.
 */
async function reconcileWorkflowAlarms(): Promise<void> {
  if (!chrome.alarms) return;
  const existing = await chrome.alarms.getAll();
  for (const a of existing) {
    if (workflowIdFromAlarm(a.name)) await chrome.alarms.clear(a.name);
  }
  const specs = alarmSpecsFor(await listWorkflows());
  for (const spec of specs) {
    chrome.alarms.create(spec.name, { periodInMinutes: spec.periodInMinutes });
  }
}

/**
 * Mark a workflow "due" (schedule alarm fired, or an event trigger matched) and
 * notify. We never auto-run — agent steps can be consequential, so the run stays
 * user-initiated (the panel shows a Due badge + one-tap Run).
 */
async function markWorkflowDue(id: string, reason: string): Promise<void> {
  const store = chrome.storage.local;
  const cur = ((await store.get(DUE_WORKFLOWS_KEY))[DUE_WORKFLOWS_KEY] as string[]) ?? [];
  if (!cur.includes(id)) await store.set({ [DUE_WORKFLOWS_KEY]: [...cur, id] });
  const wf = (await listWorkflows()).find((w) => w.id === id);
  if (wf && chrome.notifications?.create) {
    chrome.notifications.create(`wf-due-${id}`, {
      type: 'basic',
      iconUrl: 'icon-128.png',
      title: 'Chrome Buddy — workflow due',
      message: `"${wf.name}" is due (${reason}). Open the panel to run it.`,
    });
  }
}

// Scheduled alarm fired → mark due; daily registry poll → fetch + verify.
if (chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === REGISTRY_POLL_ALARM) {
      void pollRemoteRegistry();
      return;
    }
    const id = workflowIdFromAlarm(alarm.name);
    if (id) void markWorkflowDue(id, 'scheduled');
  });
}

// Event trigger (FR-WF-4): a tab navigated to a URL matching a workflow's
// urlPattern → mark it due.
if (chrome.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
    if (info.status !== 'complete' || !tab.url) return;
    void (async () => {
      for (const wf of await listWorkflows()) {
        if (wf.trigger.type === 'event' && matchesEventTrigger(wf.trigger.urlPattern, tab.url!)) {
          await markWorkflowDue(wf.id, 'page visited');
        }
      }
    })();
  });
}

// Keep alarms in sync with stored workflows on SW start/install.
chrome.runtime.onStartup?.addListener(() => void reconcileWorkflowAlarms());
chrome.runtime.onInstalled.addListener(() => void reconcileWorkflowAlarms());

// H4 — Streaming chat replies. The panel opens a Port named 'chat-stream',
// posts {type:'START', request} once, and receives a sequence of
// {type:'DELTA', text} chunks ending in {type:'DONE', text, cost}. Keeps
// the SW's key-custody guarantee — the key never leaves the SW.
// Guarded so unit tests with a partial chrome mock don't crash at import.
if (typeof chrome !== 'undefined' && chrome.runtime?.onConnect?.addListener) chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'chat-stream') return;
  let aborter: AbortController | undefined;
  port.onDisconnect.addListener(() => aborter?.abort());
  port.onMessage.addListener((msg) => {
    if (msg && typeof msg === 'object' && (msg as { type?: string }).type === 'ABORT') {
      aborter?.abort();
      return;
    }
    if (!msg || (msg as { type?: string }).type !== 'START') return;
    void (async () => {
      try {
        const req = (msg as { request: Record<string, unknown> }).request;
        const modelId = typeof req.model === 'string' ? req.model : undefined;
        const providerId = resolveProviderId(modelId);
        if (!providerId) {
          port.postMessage({ type: 'ERROR', error: 'Unknown or disabled model.' });
          return;
        }
        const key = await getStoredKey(providerId);
        if (!key) {
          port.postMessage({ type: 'ERROR', error: `No API key set for provider '${providerId}'.`, noKey: true });
          return;
        }
        aborter = new AbortController();
        const client = getLlmClient(providerId);
        const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, thoughtsTokens: 0 };
        let text = '';
        for await (const delta of client.stream({
          model: modelId,
          messages: req.messages as never,
          tools: req.tools as never,
          params: req.params as never,
          signal: aborter.signal,
        })) {
          if (delta.textDelta) {
            text += delta.textDelta;
            port.postMessage({ type: 'DELTA', text: delta.textDelta });
          }
          if (delta.usage) {
            usage.inputTokens = delta.usage.inputTokens ?? usage.inputTokens;
            usage.outputTokens = delta.usage.outputTokens ?? usage.outputTokens;
            usage.totalTokens = delta.usage.totalTokens ?? usage.totalTokens;
            if (delta.usage.cachedInputTokens) usage.cachedInputTokens = delta.usage.cachedInputTokens;
            if (delta.usage.thoughtsTokens) usage.thoughtsTokens = delta.usage.thoughtsTokens;
          }
        }
        // Cost calc using the resolved model's pricing.
        const reg = currentRegistry();
        const model = modelId ? reg.models[modelId] : reg.models[reg.defaultModel ?? ''];
        const cost = model ? estimateCost(usage, model).totalCost : 0;
        port.postMessage({ type: 'DONE', text, cost, usage });
      } catch (e) {
        port.postMessage({ type: 'ERROR', error: e instanceof Error ? e.message : String(e) });
      }
    })();
  });
});

// Register the message listener. We respond asynchronously, so we keep the
// channel open by returning `true` and resolving via sendResponse.
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isBuddyMessage(message)) return false;
  handleBuddyMessage(message).then(sendResponse, (err: unknown) =>
    sendResponse({
      type: 'ERROR',
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  return true; // keep the message channel open for the async response
});

// Voice mode (Gemini Live, WSS BidiGenerateContent). The Port name is
// 'voice-stream'; the SW owns the WebSocket so the API key never leaves
// the service worker (NFR-SEC-1).
//
// Voice gets a curated tool subset (VOICE_TOOL_NAMES) — read/search/analytical
// only, no consequential surface. Declarations are derived from the existing
// tool registry so the schemas stay in sync with the chat path.
const voiceDeclarations: LiveFunctionDeclaration[] = stubToolDefs
  .filter((d) => VOICE_TOOL_NAMES.has(d.name))
  .map((d) => ({
    name: d.name,
    description: d.description,
    parameters: d.paramsSchema as unknown as Record<string, unknown>,
  }));
const voiceHandlers: Record<string, (a: Record<string, unknown>, k: typeof getStoredKey) => Promise<import('../types').ToolResult>> = {};
for (const name of VOICE_TOOL_NAMES) {
  if (PAGE_TOOL_NAMES.has(name)) {
    // Page tools route through executePageTool — wrap to match the
    // (args, getKey) signature the Live dispatcher expects.
    voiceHandlers[name] = (a) => executePageTool(name, a);
  } else {
    const h = TOOL_HANDLERS[name];
    if (h) voiceHandlers[name] = h;
  }
}
registerVoiceStreamPort(getStoredKey, { handlers: voiceHandlers, declarations: voiceDeclarations });

export {};
