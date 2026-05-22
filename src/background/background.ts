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
import { getLlmClient, resolveProviderId, readSessionApiKey, refreshEffectiveRegistry } from '../llm/instance';
import { USER_REGISTRY_KEY } from '../llm/userRegistry';
import { updateRemoteRegistry } from '../llm/remoteRegistry';
import { LlmClient } from '../llm/client';
import { DEFAULT_REGISTRY } from '../llm/registry.default';
import { executePageTool, capturePageContext } from './pageTools';
import { executeWebhook } from './webhook';
import { executeWebSearch } from './search';
import { executeFileWrite } from './fileWrite';
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
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
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
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts }] }),
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
        // send_webhook is consequential — it only reaches here AFTER the runtime's
        // HITL gate obtained user approval (UI side). The SW just performs it.
        if (message.tool === 'send_webhook') {
          return { type: 'TOOL_EXEC', ok: true, result: await executeWebhook(message.args) };
        }
        if (message.tool === 'search_web') {
          return { type: 'TOOL_EXEC', ok: true, result: await executeWebSearch(message.args, getStoredKey) };
        }
        // write_file is consequential — only reaches here after HITL approval.
        if (message.tool === 'write_file') {
          return { type: 'TOOL_EXEC', ok: true, result: await executeFileWrite(message.args) };
        }
        // DOM-first: run page read/act tools in the SW against the active tab.
        // Restricted URLs are refused inside executePageTool with a structured error.
        const result = await executePageTool(message.tool, message.args);
        return { type: 'TOOL_EXEC', ok: true, result };
      }

      case 'PAGE_CONTEXT': {
        const page = await capturePageContext();
        return { type: 'PAGE_CONTEXT', ok: true, page };
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

export {};
