// Pure builder for Tier-3 sandbox-UI apps: the system prompt that teaches the
// model the runtime contract, the JSON→AppConfig parser/validator, and the
// message builders for the describe / iterate / repair loop. No I/O — the view
// owns the LLM calls and the live preview.
import { type AppConfig, KNOWN_APP_CAPS } from './types';
import type { ChatMessage } from '../llm/types';

export const UI_APP_BUILDER_SYSTEM = `You build a small self-contained web "micro-app" that runs INSIDE an opaque-origin sandboxed iframe in a Chrome extension side panel (~400px wide). You return ONLY JSON — no prose, no markdown fences — of the shape:
{"name": string, "description": string, "html": string, "css": string, "ui": string, "permissions": string[]}

THE RUNTIME CONTRACT (follow EXACTLY — most bugs come from breaking these):
- "html": the app's UI markup (structure only). It is set as innerHTML on a \`root\` element. Give interactive elements ids.
    ⛔ NEVER use inline handlers like onclick="..." — they CANNOT see your functions and will silently do nothing.
    ⛔ NEVER include <script> tags — they are stripped and do not run.
- "ui": the BODY of a function (root, bridge, api) => { ... }. It runs ONCE, AFTER the html is already mounted.
    ✅ Wire EVERY interaction here: root.querySelector('#id').addEventListener('click', () => { ... }).
    ⛔ Do NOT wait for DOMContentLoaded or window.onload — those already fired; your listeners would never run. Wire immediately.
    • Your variables/functions are LOCAL to this function (not global). async handlers are fine.
    • Available: the DOM (document, root), Blob, JSON, Math, fetch is NOT available — use bridge.* for anything external.
    Example "ui": "const out = root.querySelector('#out'); root.querySelector('#go').addEventListener('click', async () => { out.textContent = await bridge.gemini(root.querySelector('#q').value); });"
- "css": styles for the app. The app INHERITS Chrome Buddy's theme — prefer these so it looks native:
    • CSS vars: --cb-bg, --cb-fg, --cb-muted, --cb-border, --cb-elev, --cb-accent (the body already uses bg/fg/font).
    • Base classes: .cb-btn (primary; add .cb-ghost for secondary), .cb-input (input/textarea/select), .cb-card, .cb-muted, .cb-row.
    Add your own CSS as needed; it overrides the base. Keep it compact + mobile-narrow (~400px).
- Capabilities reach the app ONLY via \`bridge\` and \`api\`, and ONLY if declared in "permissions":
    • bridge.gemini(promptString) -> Promise<string>   // an LLM text completion (declare "gemini")
    • bridge.image({prompt, inputImage?}) -> Promise<dataUrl>  // generate an image; pass inputImage (a data URL, e.g. an uploaded photo) to RESTYLE/EDIT it instead (declare "image")
        For an upload→transform app (e.g. restyle a portrait): add <input type="file" accept="image/*">, read it with FileReader as a data URL, then call bridge.image({prompt: "...style...", inputImage: thatDataUrl}). The returned data URL is the result — show it in an <img> and offer api.download.
    • api.download(filename, content, mime?)            // trigger a file download (declare "download")
    • bridge.storage({action,key,value}) -> Promise     // persist app state across sessions (declare "storage")
        actions: 'get'|'set'|'remove'|'keys'|'clear'; get returns the value (or null)
    • bridge.page() -> Promise<{url,title,text}>        // READ the current browser tab's text (declare "page")
  There is NO network, NO chrome.* API, NO access to the user's keys. Anything else is unavailable.
- Declare only what you use (prefer the fewest). Default to [] if the app is pure-client.
- Keep the whole app focused and small. Prefer plain DOM over frameworks (no imports).

EXAMPLE permissions for an icon generator: ["gemini","download"].`;

const idOf = () => `app_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Strip a ```json … ``` (or bare ```) fence the model may wrap JSON in. */
function stripFence(text: string): string {
  const t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return fence ? fence[1].trim() : t;
}

/** Defensively clean app markup: drop <script> (innerHTML never runs them) and
 *  inline on* handlers (they reference non-existent globals → silent dead
 *  buttons; the contract requires addEventListener in `ui` instead). */
function cleanHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<script[^>]*\/?>/gi, '')
    // strip on<event>="..." / on<event>='...' attributes
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
}

export interface ParsedUiApp {
  name: string;
  description: string;
  html: string;
  css: string;
  ui: string;
  permissions: string[];
}

/** Parse the builder's reply into a validated Tier-3 fields object, or null. */
export function parseUiApp(jsonText: string): ParsedUiApp | null {
  let data: unknown;
  try {
    data = JSON.parse(stripFence(jsonText));
  } catch {
    // Salvage the first {...} block if the model wrapped it in prose.
    const m = /\{[\s\S]*\}/.exec(jsonText);
    if (!m) return null;
    try {
      data = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const html = typeof o.html === 'string' ? cleanHtml(o.html).trim() : '';
  const css = typeof o.css === 'string' ? o.css.trim() : '';
  const ui = typeof o.ui === 'string' ? o.ui.trim() : '';
  // Need a name and something to render or run.
  if (!name || (!html && !ui)) return null;
  const permissions = Array.isArray(o.permissions)
    ? (o.permissions as unknown[]).map(String).filter((p) => (KNOWN_APP_CAPS as readonly string[]).includes(p))
    : [];
  return {
    name,
    description: typeof o.description === 'string' ? o.description.trim() : '',
    html,
    css,
    ui,
    permissions: [...new Set(permissions)],
  };
}

/** Turn parsed fields into a persistable Tier-3 AppConfig (reviewed:false). */
export function toAppConfig(parsed: ParsedUiApp, id = idOf()): AppConfig {
  return {
    id,
    name: parsed.name,
    description: parsed.description,
    inputs: [],
    tier: 3,
    html: parsed.html,
    css: parsed.css,
    ui: parsed.ui,
    permissions: parsed.permissions,
    reviewed: false,
    createdAt: Date.now(),
  };
}

/** First turn: describe the app to build. */
export function describeMessages(description: string): ChatMessage[] {
  return [
    { role: 'system', content: UI_APP_BUILDER_SYSTEM },
    { role: 'user', content: `Build this app: ${description}` },
  ];
}

/** A follow-up edit, given the conversation so far + the new instruction. The
 *  prior assistant app JSON is already in `history`, so the model edits it. */
export function iterateMessage(instruction: string): ChatMessage {
  return { role: 'user', content: `Now change it: ${instruction}. Return the COMPLETE updated app JSON (same shape).` };
}

/** A repair turn after the app failed to mount/run — feed the error back. */
export function repairMessage(error: string): ChatMessage {
  return {
    role: 'user',
    content: `The app failed to run with this error:\n${error}\nReturn the COMPLETE corrected app JSON (same shape). Fix the cause; do not explain.`,
  };
}
