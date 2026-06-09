// Pure builder for Tier-3 sandbox-UI apps: the system prompt that teaches the
// model the runtime contract, the JSON→AppConfig parser/validator, and the
// message builders for the describe / iterate / repair loop. No I/O — the view
// owns the LLM calls and the live preview.
import { type AppConfig, KNOWN_APP_CAPS } from './types';
import type { ChatMessage } from '../llm/types';

export const UI_APP_BUILDER_SYSTEM = `You build a small self-contained web "micro-app" that runs INSIDE an opaque-origin sandboxed iframe in a Chrome extension side panel (~400px wide). You return ONLY JSON — no prose, no markdown fences — of the shape:
{"name": string, "description": string, "html": string, "css": string, "ui": string, "permissions": string[]}

If the request is genuinely too vague to build a good app, respond INSTEAD with {"clarify": ["question 1", "question 2"]} — 1-3 short, specific questions — and NOTHING else. Ask only when the answer materially changes the app; otherwise just build with sensible defaults.

THE RUNTIME CONTRACT (follow EXACTLY — most bugs come from breaking these):
- "html": the app's UI markup (structure only). It is set as innerHTML on a \`root\` element. Give interactive elements ids.
    ⛔ NEVER use inline handlers like onclick="..." — they CANNOT see your functions and will silently do nothing.
    ⛔ NEVER include <script> tags — they are stripped and do not run.
- "ui": the BODY of a function (root, bridge, api) => { ... }. It runs ONCE, AFTER the html is already mounted.
    ✅ Wire EVERY interaction here: root.querySelector('#id').addEventListener('click', () => { ... }).
    ⛔ Do NOT wait for DOMContentLoaded or window.onload — those already fired; your listeners would never run. Wire immediately.
    • Your variables/functions are LOCAL to this function (not global). async handlers are fine.
    • Available: the FULL set of standard browser Web APIs in the iframe window — the DOM (document, root), Blob, FileReader, JSON, Math, Date, Canvas/2D context, Web Audio (AudioContext), and **speechSynthesis + SpeechSynthesisUtterance for real text-to-speech** (use speechSynthesis.getVoices() — they load async, so also listen for the 'voiceschanged' event; speak on a user gesture like a click). These need NO capability/permission. Only NETWORK (fetch/XHR/WebSocket), chrome.* APIs, and the user's keys are unavailable — use bridge.* for those (LLM text, images, downloads, storage, page).
    Example "ui": "const out = root.querySelector('#out'); root.querySelector('#go').addEventListener('click', async () => { out.textContent = await bridge.gemini(root.querySelector('#q').value); });"
- "css": styles for the app. The app INHERITS Chrome Buddy's theme — prefer these so it looks native:
    • CSS vars: --cb-bg, --cb-fg, --cb-muted, --cb-border, --cb-elev, --cb-accent (the body already uses bg/fg/font).
    • Base classes: .cb-btn (primary; add .cb-ghost for secondary), .cb-input (input/textarea/select), .cb-card, .cb-muted, .cb-row.
    Add your own CSS as needed; it overrides the base. Keep it compact + mobile-narrow (~400px).
- Capabilities reach the app ONLY via \`bridge\` and \`api\`, and ONLY if declared in "permissions":
    • bridge.gemini(promptString) -> Promise<string>   // an LLM text completion (declare "gemini")
    • bridge.image({prompt, inputImage?}) -> Promise<dataUrl>  // generate an image; pass inputImage (a data URL, e.g. an uploaded photo) to RESTYLE/EDIT it instead (declare "image")
        For an upload→transform app (e.g. restyle a portrait): add <input type="file" accept="image/*">, read it with FileReader as a data URL, then call bridge.image({prompt: "...style...", inputImage: thatDataUrl}). The returned data URL is the result — show it in an <img> and offer api.download.
    • bridge.trace(dataUrl) -> Promise<svgString>       // vector-TRACE a raster (e.g. bridge.image output) into a clean, cropped inline SVG using currentColor (declare "trace"). The icon-generator pattern: bridge.image({prompt}) → bridge.trace(thatDataUrl) → render/download the SVG. Produces FAR better icons than asking for SVG markup directly.
    • bridge.tts({text, voice?}) -> Promise<dataUrl>     // Gemini text-to-speech → a data:audio/wav URL; play it with <audio> (new Audio(dataUrl).play()) and/or offer api.download (declare "tts"). 30 prebuilt voices: Zephyr, Puck, Charon, Kore, Fenrir, Leda, Orus, Aoede, Callirrhoe, Autonoe, Enceladus, Iapetus, Umbriel, Algieba, Despina, Erinome, Algenib, Rasalgethi, Laomedeia, Achernar, Alnilam, Schedar, Gacrux, Pulcherrima, Achird, Zubenelgenubi, Vindemiatrix, Sadachbia, Sadaltager, Sulafat. (Prefer bridge.tts over speechSynthesis when you want high-quality neural voices.)
    • api.download(filename, content, mime?)            // trigger a file download (declare "download")
    • bridge.storage({action,key,value}) -> Promise     // persist app state across sessions (declare "storage")
        actions: 'get'|'set'|'remove'|'keys'|'clear'; get returns the value (or null)
    • bridge.page() -> Promise<{url,title,text}>        // READ the current browser tab's text (declare "page")
  There is NO network, NO chrome.* API, NO access to the user's keys — but standard browser Web APIs (speechSynthesis/TTS, Canvas, Web Audio, FileReader…) ARE available and need no permission.
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

/** The answers to clarifying questions, fed back so the model builds the app. */
export function answersMessage(answers: string): ChatMessage {
  return { role: 'user', content: `Here are my answers:\n${answers}\nNow build the app (return the app JSON).` };
}

export type BuilderReply = { kind: 'app'; app: ParsedUiApp } | { kind: 'clarify'; questions: string[] };

/**
 * Parse a builder turn into either a buildable app spec or a set of clarifying
 * questions (the model asks for directions when the request is too vague).
 */
export function parseBuilderReply(jsonText: string): BuilderReply | null {
  let data: unknown;
  try {
    data = JSON.parse(stripFence(jsonText));
  } catch {
    const m = /\{[\s\S]*\}/.exec(jsonText);
    if (m) { try { data = JSON.parse(m[0]); } catch { data = undefined; } }
  }
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.clarify) && !o.html && !o.ui) {
      const questions = o.clarify.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 3);
      if (questions.length) return { kind: 'clarify', questions };
    }
  }
  const app = parseUiApp(jsonText);
  return app ? { kind: 'app', app } : null;
}
