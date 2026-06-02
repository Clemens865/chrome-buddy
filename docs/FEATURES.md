# Chrome Buddy — Features

> A complete catalog of what Chrome Buddy can do, as of **v0.5.3**. This is the
> *capability* reference (every mode, tool, app, setting). For how the system is
> built, see [`ARCHITECTURE.md`](ARCHITECTURE.md).

Chrome Buddy is a Manifest-V3 Chrome **side-panel** assistant: model-transparent,
bring-your-own-key, zero remote code, all data local. It combines four layers
over one shared tool registry — focused micro-apps, an agentic chat, a
natural-language app builder, and user-extensible skills/workflows/MCP.

## Contents
1. [Chat & modes](#1-chat--modes)
2. [Models, cost & keys](#2-models-cost--keys)
3. [Agent tools](#3-agent-tools)
4. [Library (RAG)](#4-library-rag)
5. [Apps, builder & marketplace](#5-apps-builder--marketplace)
6. [Page control & Vision](#6-page-control--vision)
7. [Voice & Voice Transcriber](#7-voice--voice-transcriber)
8. [Console Inspector](#8-console-inspector)
9. [Skills, workflows, webhooks & MCP](#9-skills-workflows-webhooks--mcp)
10. [GitHub](#10-github)
11. [Settings](#11-settings)
12. [Privacy & security](#12-privacy--security)
13. [Install & platform](#13-install--platform)

---

## 1. Chat & modes

**Five chat modes** (a segmented control in the composer; a `?` popover explains them in-app):
- **Auto** — classifies your message and routes simple Q&A to plain chat, page/action tasks to the agent.
- **Ask** — plain chat, **no tools**. Fastest/cheapest. Your always-on Library collections are auto-added.
- **Agent** — the full plan→act→observe→reflect loop with tools + HITL confirmation.
- **Vision** — Buddy *sees* and drives the active tab (Gemini Computer Use). Slower/costlier.
- **Voice** — real-time bidirectional voice chat (Gemini Live).

**Chat experience**
- **Streaming replies** — the answer streams into a growing bubble (token-by-token), with Stop to abort.
- **Conversational memory** — recent turns are carried so follow-ups ("tell me more about that") work; a fresh chat opens each time the panel opens, and past chats are saved + listable in a "Chats" slide-over (open / delete / new).
- **Artifact cards** — fenced code blocks become collapsible cards with Copy / Download / open-in-viewer.
- **Attachments** — images (sent as vision parts) + text files (folded into context).
- **Multi-tab context** — a **Tabs** chip pins other open tabs as context for the chat.
- **Attach this page** — toggle to include the active tab's distilled text.
- **Think harder** — toggle that runs the final reasoning/synthesis at `thinking: 'high'` (more deliberation, slower + costlier; Gemini-specific).
- **Per-chat model picker** — choose the exact model for this chat (see §2).
- **Save to Library** — index a reply into your Library.
- **Run history** — every run is saved (task, answer, outcome, tools, model, cost) and listed in History; clearable in Settings. A "reuse" chip offers to replay a similar past task.

**Agentic safety + control**
- **Plan-approval gate** (opt-in, on by default) — review/edit the numbered plan before it runs.
- **HITL confirmation** — consequential actions (write file, send webhook, GitHub write, untrusted MCP tools) show an approve/cancel card with the exact arguments before executing; nothing consequential runs without approval.
- **ask_user** — the agent can pause to ask you for a missing input (with optional choices).
- **Human gate** — on a CAPTCHA/login wall, the run pauses with a "solve it, then Resume" card.
- **Resume interrupted run** — if the panel closes mid-run, reopening offers to resume (completed steps skipped; consequential actions not re-fired).
- **Sub-agents (decompose, opt-in)** — a multi-phase task splits into a sequential sub-task queue, each with focused context, under one shared budget ceiling (cost / steps / wall-clock); simple tasks stay on the single loop.

---

## 2. Models, cost & keys

**Model picker** (a chip in the composer, the App Builder, and Settings — one shared choice):
- Lists the **actual models**, not abstract tiers:
  - **Auto (Balanced)** — smart default.
  - **Gemini** — Flash-Lite, Flash, Pro across 2.5 + 3.x (cheapest→priciest, each with a `$`/`$$`/`$$$` hint).
  - **Claude** — **Haiku 4.5**, **Sonnet 4.6**, **Opus 4.8** — **key-gated** (shown disabled with "needs Anthropic key" until you add one).
- Picking a named model **pins it exactly** (no surprise Opus); Auto keeps the smart default. The chat header shows the model in use.
- Out of the box it resolves to a **cheap Gemini** so casual chat never silently bills premium rates — you opt up explicitly.

**Providers**
- **Google Gemini** — default; one BYO key unlocks chat, image, audio, vision, embeddings.
- **Anthropic** — optional key → the Claude models above.
- **OpenAI-compatible** — custom providers/models can be added to the registry.
- **Model registry** — a bundled default set, overlaid by user-added custom models and by signed remote updates (Ed25519-verified).
- Image generation, audio transcription, voice, vision and embeddings are **pinned to Gemini** regardless of the chat model.

**Cost**
- **Per-call cost** estimate on every response (input/output/cached broken out).
- **Session cost chip** in the composer (`≈ $x.xx`).
- **Daily spend ledger** (resets at local midnight).
- **Budget caps** (Settings): **per-run ≈ $0.50**, **per-day ≈ $5**, **max steps 24** — `0` disables a cap; the agent halts gracefully when a cap is hit (caps are shared across a sub-agent tree).

**API keys**
- **BYO key**, stored **only** in `chrome.storage.session` (in-memory, cleared when the browser session ends; never disk/sync). Validated live before use; never echoed back to the UI. Same custody for the GitHub token + MCP bearer tokens.

---

## 3. Agent tools

Available in Agent mode (and Auto when it routes to the agent). Tools marked **⚠ consequential** always fire the HITL confirmation gate.

**Page driving** — `navigate`, `click`, `type`, `scroll`, `read_dom` (distilled text + elements + tables), `extract` (structured data to a schema), `screenshot`, `summarize`.

**Browser-native research (read-only)** — `list_tabs`, `read_tab` (read another open tab's text, incl. pages behind your login).

**Web** — `search_web` (grounded web answer with sources), `fetch_url` (read/summarize a public URL: html/json/csv/pdf/image…).

**Files** — `list_files`, `read_file`, **⚠ `write_file`** (your chosen folder via File System Access, or Downloads fallback).

**GitHub** — `github_read`, `github_list`, **⚠ `github_write`** (commit via the Contents API).

**Knowledge** — `search_library` (your local RAG, optionally scoped to a collection), `file_search` (Gemini server-side File Search stores).

**Notes** — `note_save`, `note_get`, `note_list` (private in-extension notebook).

**Webhooks** — **⚠ `send_webhook`** (POST JSON to a saved/ad-hoc endpoint), `list_webhooks`.

**Console diagnostics** — `analyze_errors`, `web_vitals`, `read_network`, `scan_security`, `read_storage`, `scan_sensitive_data`, `detect_tech_stack`, `analyze_a11y`, `analyze_seo`, `read_console`.

**Marketplace** — `search_catalog` (find installable apps/skills).

**Skills** — `call_skill` (run a saved skill as a nested run).

**Input** — `ask_user` (request a missing parameter mid-run).

**MCP** — any enabled MCP server's tools, namespaced `mcp__<server>__<tool>` (⚠ gated unless you trust the specific tool).

---

## 4. Library (RAG)

A local, private, vector-indexed knowledge base over your notes, chats, files, and pages.

**Collections** — named buckets for your knowledge:
- **Kinds**: `profile`, `project`, `general`.
- **Auto-context modes**: **always** (pulled into every chat — e.g. Personal Profile), **active** (pulled when you toggle it on for the session via the composer's **Library** chip), **manual** (model-only, via `search_library`).
- Seeded defaults: **General** (manual) + **Personal Profile** (always-on).
- **Per-doc note** — optional framing ("is a competitor", "about our product") surfaced with every retrieved snippet.

**Ingest**
- **+ Files** — multi-select; formats: markdown/mdx/txt/rst, **PDF** (text-extracted in-panel via pdfjs), csv/tsv/json/yaml/toml, html/xml, and common code files.
- **+ This page** — one click distills the active tab into the chosen collection. Also a **right-click → "Add page to Library ▸ \<collection\>"** context menu.
- **+ Folder** — recursive import of a picked folder (File System Access).
- **Auto-mirror** — saved chats + notes are indexed automatically; a one-time **Backfill** (Settings) indexes existing chats/notes.

**Retrieval**
- Embeddings: **`gemini-embedding-001`**, **768-dim**, **task-typed** (query vs document), L2-normalized; a **self-healing migration** re-embeds old docs automatically on the next search after an upgrade.
- **Collection-scoped search**; the agent knows your collections (their ids/descriptions are in its system context) so it can target the right one.
- **Auto-context** — always-on collections inject every message; active collections inject when toggled on; an audit card shows what was pulled in.
- **LLM consolidation** (opt-in) — a new manual/note doc is compared to the most similar existing one and merged/replaced/kept, scoped within the collection.
- **Doc cap** (default 1000) evicts the oldest when exceeded.

**Manage** — list/search/view/edit (re-index)/delete docs; collections create/delete (deleting reassigns its docs to General).

---

## 5. Apps, builder & marketplace

**Three app tiers** (all stored as data, never committed code):
- **Tier 1 — declarative**: a form + prompt template; no code.
- **Tier 2 — sandboxed JS**: a `(inputs, bridge) => value` function in an opaque-origin iframe; first-run review gate.
- **Tier 3 — sandbox-UI**: a full `{html, css, ui}` micro-app rendering its own DOM in the sandbox; first-run review gate.

**Capability bridge** (Tier 2/3) — zero ambient authority; capabilities reached only through a gated `postMessage` bridge: `bridge.gemini` (text), `bridge.image` (generate / edit with an input image), `api.download`, `bridge.storage` (per-app KV), `bridge.page` (read-only page snapshot). Rate-limited; capabilities allowlisted.

**Built-in apps** (the Apps grid):
| App | What it does |
|---|---|
| Console Inspector | Read console logs + multi-panel page health analysis |
| Image Generator | Text → image |
| Audio Transcriber | Upload an audio file → transcript |
| Voice Transcriber | Record → transcript → summarize / clean up / meeting notes (+ live captions) |
| Webhook Flows | One-tap snapshot a page → POST to a saved webhook |
| Scrape to Table | Extract structured data → CSV |
| Data Visualizer | CSV/JSON/table → charts |
| Tab Manager | Search, dedupe, group + save tab sessions |
| SVG Icon Generator | Describe → inline SVG |
| App Builder | Build your own Tier-3 app from a description |
| BrandSnap AI | (Tier-3 built-in) place a logo on a canvas → branded scene |

**App Builder** — describe an app → optional clarifying questions → live preview → iterate in natural language → save. Uses the shared model picker (build with Gemini or Claude). Apps **export/import** as JSON (import re-validates: fresh ids, allowlisted caps, review gate re-armed).

**Marketplace** — a public GitHub catalog, browsed/installed over raw HTTPS (no auth). Install fetches the bundle, re-validates it, and shows the review gate. Current catalog: **BrandSnap AI**, **Portrait Maker**, **Email Polisher**, **Regex Explainer**. Versioned (update-available checks); the agent can discover entries via `search_catalog`.

---

## 6. Page control & Vision

**Page reading & control**
- A **DOM distiller** turns the live page into clean text + interactive elements + tables (the basis of `read_dom`/`extract`/`summarize` and chat page-context).
- Actions (`click`/`type`/`scroll`/`navigate`) run via **synthetic events** by default; a **CDP/debugger** trusted-input fallback handles hardened sites (it shows Chrome's debugging banner; warned once).
- **Undriveable URLs** (chrome://, Web Store, PDFs, file://, extension pages…) are detected and rejected gracefully.
- **Browser-native research** — read other open tabs by id, including pages behind your login.

**Vision Mode (Gemini Computer Use)**
- Loop: **screenshot → the model picks a coordinate action (click/type/scroll/…) → CDP executes it → re-screenshot → repeat**, until it returns a text summary.
- Screenshots are captured via **CDP `Page.captureScreenshot`** (uses the debugger permission Vision already holds — works without `<all_urls>`).
- **Safety**: the model self-flags consequential steps (forms, purchases, login, downloads, CAPTCHAs) for your confirmation; a **"Confirm every Vision action"** Settings toggle gates *all* actions. Page content is treated as untrusted.
- Narration + each action + result stream into the chat; cost is metered (it's image-token heavy → slower/costlier; use it for visual tasks the DOM agent can't do).

---

## 7. Voice & Voice Transcriber

**Voice chat (Gemini Live)** — real-time bidirectional voice: your mic (16 kHz) streams to the model, its audio (24 kHz) plays back; live transcript; function-calling works mid-conversation. STT input is also available in the composer.

**Voice Transcriber app** (robust record-then-transcribe)
- **Record** the mic (with a timer) → on stop it's encoded to WAV and transcribed in one shot by Gemini (accurate, punctuated).
- **Live captions** while recording (browser SpeechRecognition, preview-only; the Gemini transcript is authoritative).
- **Sessions** — each recording is saved (title · date · time · length) and listed like history.
- **Transforms** on a transcript — **Summarize**, **Clean up**, **Meeting notes**, **Add speakers** — each saved onto the session as its own tab; Copy / + Library per view.
- **Audio Transcriber** — a separate app to transcribe an uploaded audio file.

---

## 8. Console Inspector

An 11-tab page-diagnostics app. Console + network are captured via `chrome.debugger`; every analyzer is also an agent tool.

- **Health** (default tab) — one weighted 0–100 score composing all categories + a global findings list.
- **Errors** — framework-aware patterns (JS/React/Vue/Angular/network/CORS/TS…) with fixes.
- **Network** — request summary (failed/slow/large, content types).
- **Web Vitals** — LCP / FID / CLS / FCP / TTFB with good/needs-work/poor verdicts.
- **Security** — HTTPS, CSP, mixed content, cookie flags.
- **Storage** — localStorage/sessionStorage/cookies summary (values never shown in clear).
- **Secrets/PII** — scan for API keys, JWTs, cloud/PEM keys, credit cards (Luhn), emails/phones — **redacted** previews.
- **Tech stack** — Wappalyzer-style framework/library fingerprinting with evidence.
- **A11y** — alt text, labels, heading order, lang, titles.
- **SEO** — title/description/canonical/OG/structured-data/h1… → 0–100 score.
- Every analytical panel has **Copy fix-prompt** (paste into your IDE) + **Send to Buddy**.

---

## 9. Skills, workflows, webhooks & MCP

**Skills** — saved, re-runnable prompts (data, not code):
- Create/edit/delete; Chat or Agent mode; `{{variable}}` inputs auto-detected; optional allowed-tools whitelist.
- Import/export as JSON; **import a Claude `SKILL.md`** (frontmatter → skill, with a review gate for unknown tools).
- Agent-callable via `call_skill` (nested run sharing the parent budget; no recursion).

**Workflows** — multi-step automations:
- Build by description or a manual step editor (reorder; Chat/Agent per step; output threads forward).
- **Triggers**: Manual, **Schedule** (`chrome.alarms`), or **Event** (URL pattern). Scheduled/event triggers mark a workflow **Due** + notify — they **never auto-run** (you run it one-tap).
- Import/export as JSON.

**Webhooks**
- **Address book** — named endpoints (URL + headers + note), HTTPS-only (http for localhost), URL **masked** in the UI. The agent sends by name; `send_webhook` always confirms.
- **Webhook Flows** — one-tap "snapshot the page → POST to a saved webhook": snapshot mode (none/meta/text/full), include selection/profile, optional prompt template with `{url}`/`{title}`/`{selected_text}`, per-flow trust-no-confirm, categories, last-run status.

**MCP connector** — connect external Model Context Protocol servers (Streamable HTTP + SSE):
- Add/test/discover tools; auth none or bearer (token in session storage).
- **Enable-in-agent** per server (off by default), **per-tool include** filter, **per-tool trust** (`always` skips the gate, default `confirm`).
- Tool names namespaced `mcp__<server>__<tool>`; descriptions sanitized against injection.

---

## 10. GitHub

Read/write/list a repo via the Contents API:
- `github_read` / `github_list` (optional branch/ref), and **⚠ `github_write`** (create/update a file; always HITL-confirmed).
- A **default repo** (Settings) is used when you don't name one; the **token** lives in session storage only.

---

## 11. Settings

- **Appearance** — theme (slate / cream / graphite) + accent color.
- **Profile** — professional & personal profiles (name / role / about); **Personalize replies** toggle attaches the active profile to chat.
- **On web pages** — **Floating overlay** (default off): show the panel floating over pages.
- **API keys** — Gemini (required) + Anthropic (optional, unlocks Claude); session-only, validated.
- **Model** — the model picker (Auto + named Gemini/Claude) + "Prefer on-device (Nano)" for short private chats + custom-model editor + a "test the model" button.
- **Budget** — per-run / per-day / max-steps caps.
- **Permissions** — review-plans-before-running (on), confirm-every-Vision-action (off), decompose-tasks (off).
- **Library** — backfill existing chats/notes, auto-context toggle, consolidation toggle, max-docs.
- **File Search stores** — Gemini server-side RAG store ids for `file_search`.
- **GitHub** — token + default repo.
- **Local files** — pick/forget a root folder (File System Access).
- **MCP servers** — manage connectors.
- **Webhooks** — manage the address book.
- **Data** — clear run history.

---

## 12. Privacy & security

- **All local** — no account, no sign-in, no cloud sync; your data lives in the browser's IndexedDB.
- **BYO-key, key-in-session-only** — keys (Gemini/Anthropic/GitHub/MCP) live only in `chrome.storage.session`; cleared on browser exit; never disk, never the UI, never sent anywhere but the model provider.
- **Zero-RCE** — Manifest V3; app code runs only in an opaque-origin sandbox; nothing is fetched as remote script; imported apps re-arm a review gate.
- **HITL by default** — consequential actions (write/send/commit/untrusted MCP) confirm with exact arguments; trust is opt-in and granular.
- **Untrusted page content** — page text is fenced as untrusted in prompts; MCP tool descriptions are sanitized.
- **Restricted URLs** — page tools refuse chrome://, the Web Store, file://, extension pages, etc.

---

## 13. Install & platform

- **Manifest V3**, Chrome **116+**; surfaces: the **side panel** (primary), an opt-in **overlay** (extension-origin iframe, shared storage), and the **sandbox** iframe for apps.
- **Install** — download the latest `chrome-buddy-vX.Y.Z.zip` from the [Releases page](https://github.com/Clemens865/chrome-buddy/releases/latest), unzip, `chrome://extensions` → Developer mode → **Load unpacked** → pick the folder, then paste a Gemini key. No toolchain needed (the zip is pre-built; tagged releases build + attach it automatically).
- **From source** — `npm install && npm run build` → load `dist/` unpacked.

---

*Reflects v0.5.3. Exact constants (budget caps, model ids, embedding dims) live in the cited source files and are authoritative if they ever drift from this doc.*
