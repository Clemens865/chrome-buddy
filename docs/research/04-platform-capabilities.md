# Chrome Extension Platform — Capabilities & Limits (MV3, 2026)

> What is and isn't possible for a universal agentic AI extension. Verdicts: ✅ possible · ⚠️ possible with caveats · ❌ not possible.

## 1. Core MV3 limitations
- **Service worker is stateless & disposable.** It idles out (~30s of inactivity), restarts on events. No persistent background page. → Every agent step must be **resumable from IndexedDB/`chrome.storage`**; use an **offscreen document** for anything long-running, audio, or DOM parsing.
- **Remote-code ban.** ❌ Cannot `fetch()`-and-`eval()` external JS, no remotely-hosted scripts, strict CSP. ✅ Allowed: fetching/caching remote **JSON data/config**, `scripting.executeScript({func, args})`, **WASM** (`wasm-unsafe-eval`), sandboxed iframes. This is the rule the whole skills system must respect.
- **CSP** blocks inline scripts and `eval` in extension pages.

## 2. Filesystem — "a root folder it can read & write" ⚠️/✅
- **File System Access API** (`showDirectoryPicker`): ✅ user picks a root folder once; extension gets **read+write** to that whole tree. **Persistent permissions** (Chrome 122+) let access survive restarts, but the browser may still require a one-click re-grant per session and the **initial pick needs a user gesture**. Best zero-install option.
- **Native messaging host**: ✅ full, prompt-free filesystem access (a small native binary you ship). Cleanest UX for a true always-available root folder, but needs an **installer** and per-OS packaging.
- **OPFS** (Origin Private File System): ✅ fast sandboxed storage, but **not** a user-visible folder.
- **Downloads API**: write-only into Downloads, no read-back.
- **Verdict**: Yes — via File System Access API (default, no install) or a native host (best UX, needs installer). Many ship both: web API by default, native host as an optional upgrade.

## 3. Browser control / automation ✅ (with caveats)
- `chrome.tabs` — open/close/navigate/query/group tabs.
- `chrome.scripting.executeScript` — inject functions to read DOM, click, type, fill forms, scroll (synthetic events; **no debugger banner**; weaker on canvas/drag/hardened sites).
- `chrome.debugger` (CDP) — **trusted-input** clicks/keystrokes, full DevTools Protocol; powerful and reliable but shows an **un-hideable "extension is debugging this browser" banner**.
- `captureVisibleTab` — screenshots for vision analysis.
- **`gemini-2.5-computer-use` loop**: screenshot in → model returns action (normalized 0–999 coords) → execute → screenshot back. Returns `safety_decision: "require_confirmation"`; you resend with `safety_acknowledgement: "true"` after user approval.
- ❌ **Can't automate**: cross-origin iframes you lack permission for, CAPTCHAs/bot-detection, `chrome://` pages, the Web Store. Reliability on JS-heavy checkout/SPAs/auth flows is the industry-wide weak spot.
- **Hybrid recommendation**: `scripting` synthetic events for simple DOM tasks, CDP only when needed → minimizes banner exposure.

## 4. Skills / sub-agents — create & load inside the extension ✅ (as data)
- **❌ Not allowed**: fetch-and-eval user code from a server.
- **✅ Allowed & recommended**: **data-driven skills** — JSON defining name, trigger, system prompt, allowed tools/functions, inputs, output schema. The agent discovers/invokes them via Gemini **function calling**. Import/export as self-contained JSON, re-validated locally.
- **✅ Executable user code** (advanced): via `chrome.userScripts` API (Chrome 120+, gated behind a toggle), sandboxed iframe, WASM, or a bundled interpreter/DSL — never remote eval.
- **Verdict**: a user-extensible skill/agent system is fully feasible if skills are **data, not code**; offer code-skills only through `userScripts`/sandbox.

## 5. Webhooks & external integrations ✅
- `fetch()` to any domain in `host_permissions` (Slack, Notion, Zapier, custom backends). CORS isn't a blocker for declared hosts; call from background SW or offscreen doc. `declarativeNetRequest` for header/redirect rules.

## 6. STT (speech-to-text) ✅
- **Web Speech API** (`SpeechRecognition`): free, built-in, but Chrome routes audio to Google servers (not offline), mic permission needed, runs in a page/content/offscreen context (not SW).
- **Gemini Live API**: real-time streaming STT over WebSocket (proven in MicroLabs).
- **MediaRecorder + cloud STT**: record then transcribe. Best accuracy/control.

## 7. TTS (text-to-speech) ✅
- `chrome.tts` (extension API, OS voices), Web Speech `SpeechSynthesis` (page context), or **Gemini TTS models** for high quality / controllable voices. Tradeoff: native = free/instant/robotic; Gemini = better, costs tokens/latency.

## 8. Image generation & editing ✅
- **Gen**: Gemini **Imagen 4** / **Nano Banana** (`gemini-2.5-flash-image`) via API. **Edit**: Nano Banana editing + **Canvas** for crop/filter/composite. Display in panel, save via File System Access / downloads. No platform limit on showing/saving generated images.

## 9. UI surfaces ✅/⚠️
- **`chrome.sidePanel`**: ✅ persists across tab navigation, user-resizable (drag), can be set global or per-tab, `openPanelOnActionClick`. ⚠️ **Cannot be force-opened programmatically** — needs a user gesture (toolbar click or keyboard command). "Always-on" = pinned across tabs + opened via gesture/keyboard, not auto-launched.
- **Popup**: throwaway, closes on blur — only for quick actions.
- **Content-script overlay**: in-page anchored UI (selection toolbars, inline cards).
- **Offscreen document**: invisible DOM context for audio/parsing/clipboard/long work the SW can't do.

## 10. Storage & memory ✅
- `chrome.storage.local` ~10 MB (or unlimited with `unlimitedStorage` permission), `sync` ~100 KB (settings only), `session` ~10 MB in-memory (good for API keys).
- **IndexedDB** — large, structured; the right home for **cross-session agent memory**, history, embeddings/RAG, cached skills.

## Feasibility Summary

| Desired feature | Verdict | Recommended approach | Key caveat |
|---|---|---|---|
| Root folder read/write | ✅ | File System Access API (default) or native host (best UX) | Web API needs gesture/re-grant; native host needs installer |
| Multi-step browser control | ✅ | Hybrid: `scripting` for simple, CDP for hard, Computer Use as fallback | CDP shows debugger banner |
| Screenshot + analyze | ✅ | `captureVisibleTab` → Gemini vision | viewport only (stitch for full page) |
| Custom skills/agents | ✅ | Data-driven JSON skills + function calling; `userScripts` for code | no remote eval |
| Webhooks / integrations | ✅ | `fetch` from SW/offscreen + `host_permissions` | declare hosts upfront |
| STT | ✅ | Web Speech (free) or Gemini Live (quality) | not in SW; not offline (Web Speech) |
| TTS | ✅ | `chrome.tts` (free) or Gemini TTS (quality) | quality vs cost |
| Image gen / edit | ✅ | Imagen/Nano Banana + Canvas | token cost |
| Always-on expandable sidebar | ⚠️ | `chrome.sidePanel` global + pin + keyboard command | can't auto-open without gesture |
| Cross-session memory | ✅ | IndexedDB (+ embeddings for recall) | manage size yourself |

## Three design rules (carry the whole architecture)
1. **Treat the SW as stateless & disposable** — every step resumable; offscreen doc for long/audio/DOM work.
2. **Stay on the right side of the remote-code ban** — skills are *data*; executable user code only via `chrome.userScripts`/sandbox; never fetch-and-eval. (Also what passes Web Store review.)
3. **Pick the right UI surface per job** — sidePanel for the persistent agent, content-overlay for in-page UI, offscreen for invisible work, popup for throwaway actions.

## Baseline manifest permissions
`debugger`, `tabs`, `scripting`, `activeTab`, `sidePanel`, `storage`, `unlimitedStorage`, `offscreen`, `nativeMessaging` (if shipping host), `userScripts` (if offering code-skills) + enumerated `host_permissions` for API/webhook domains and drivable sites.

## Two strategic forks to decide early
- **Folder access**: native host (best UX, installer) vs File System Access API (zero install, weaker persistence). Can ship both.
- **Automation engine**: CDP/`debugger` (powerful, trusted input, banner) vs `scripting` synthetic events (no banner, weaker on hardened sites). Hybrid minimizes banner exposure.

**Net**: every feature on the wishlist is achievable in MV3 (2026). Native messaging and CDP are the two areas where you trade setup/UX cost for full capability.
