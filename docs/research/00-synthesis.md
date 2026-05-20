# Chrome_Buddy — Research Synthesis & Direction

> **Goal**: the best **universal agentic + LLM Chrome extension** — covering ~80% of any LLM task or browser task for any profession. App suite + agentic chat with multi-step execution + user-extensible skills + workflows.
>
> Investigation phase output. Detailed reports:
> - [`01-microlabs-audit.md`](./01-microlabs-audit.md) — prior extension + weaknesses
> - [`02-competitor-landscape.md`](./02-competitor-landscape.md) — 15 mainstream assistants
> - [`03-gemini-models.md`](./03-gemini-models.md) — full Gemini lineup + Chrome built-in AI
> - [`04-platform-capabilities.md`](./04-platform-capabilities.md) — MV3 capabilities & limits (filesystem, automation, skills, STT/TTS, image, UI, memory)
> - [`05-agentic-landscape-deep.md`](./05-agentic-landscape-deep.md) — deep agentic/browser-automation scan + open-source spine
> - [`06-architecture-skills-ui.md`](./06-architecture-skills-ui.md) — skills schema, agent loop, workflow builder, UI shell, app/agent coexistence
> - [`07-extensibility-future-proofing.md`](./07-extensibility-future-proofing.md) — self-extending micro-apps (import/AI-generate) + in-app & remote-updatable model/provider registry
> - [`08-app-portfolio.md`](./08-app-portfolio.md) — all 64 MicroLabs apps classified (own-app vs agent-workflow vs hybrid vs subsumed); v1 8-app shortlist; Console Buddy + Image Studio specs

## TL;DR

We've built MicroLabs (64 Gemini-powered micro-apps, React+Vite MV3) — strong UX, weak on security/tests/storage/permissions. The market has ~15 "agentic" extensions but **most are assistants, not agents**; the few real automation tools (HARPA, Bardeen, Zapier) are cloud-bound and model-opaque. The clearest open lane: a **privacy-respecting, model-transparent agent that does reliable, verified, multi-step work with cross-session memory.** Gemini gives us the full toolkit — `gemini-3.5-flash` as workhorse, Nano on-device for free/private quick tasks, Computer Use for real automation.

## What to keep from MicroLabs
- DRY app templating (`GenericApp` + config registry)
- Rich page-context extraction (meta/OG/structured data, site-type, reading time)
- Integration/webhook abstraction
- User-profile personalization
- Gemini hook patterns (system prompt, JSON mode, thinking levels, Search grounding)

## What to fix from day one
1. **Security**: BYO key in `chrome.storage.session`, all cloud calls from background SW; never bundle a key. Add prompt-injection guards + per-call cost/rate guards.
2. **Permissions**: drop `<all_urls>`/`debugger` defaults; use optional + on-demand host permissions.
3. **Storage**: single versioned schema + migrations; configurable history; quota awareness.
4. **Quality**: ESLint+Prettier+husky, Vitest, CI/CD, release/version automation — set up before features.
5. **Error handling**: try/catch on all async, retry/queue for integrations, surfaced errors.
6. **Performance**: cache page context, avoid re-extracting 50k chars, lazy MAIN-world injection, let SW sleep.

## Differentiators to build (the open lanes)
1. **Privacy + real agency** — local-first Nano for quick tasks, cloud only when needed; DOM automation that actually acts.
2. **Model transparency** — show which model ran, token + $ usage live; let users pick/switch model per task.
3. **Verified multi-step autonomy** — human-in-the-loop confirmation before consequential actions (send/buy/delete).
4. **Cross-session memory** — persistent memory that feeds automations (the siloed gap between knowledge tools and automation tools).
5. **Proactive assistance** — context-triggered help (à la Liminary/Recall) instead of waiting to be summoned.

## Recommended Gemini usage
- **Workhorse**: `gemini-3.5-flash` (GA, frontier value, 1M ctx, ~4× faster).
- **Cheap/fast**: `gemini-2.5-flash-lite` ($0.10/$0.40) or `gemini-3.1-flash-lite`.
- **Hard reasoning**: `gemini-3.1-pro-preview` (reserve; 8× output cost).
- **On-device/free/private**: Gemini Nano via Prompt/Summarizer/Translator (content script ONLY — not the SW; <500 tok in/<200 out).
- **Automation**: `gemini-2.5-computer-use-preview` (drives UIs).
- **Voice**: `gemini-3.1-flash-live`. **RAG/search**: `gemini-embedding-001/2`.
- **Tiered fallback**: Nano → Flash-Lite/3.5-Flash → Pro; batch (-50%) + context caching for bulk.

## Architecture rule (memorize)
**Cloud Gemini calls → background service worker** (key stays out of page DOM).
**On-device Nano → content script / offscreen document** (Nano can't run in a worker).
Message-pass between the two.

## Table-stakes (must match competitors)
Page/PDF/YouTube summarize+chat · multi-model + mid-task switch · sidebar + inline overlay · tone-aware writing/replies · translation/OCR · cross-device sync.

## Decisions (locked 2026-05-20)
- **Product shape**: **Hybrid** — a genuine agent as the centerpiece + a handful of high-value tools (summarize, chat with page, writing).
- **Automation scope (v1)**: **Full Computer Use** — drive arbitrary UIs via `gemini-2.5-computer-use-preview-10-2025` (click/type/navigate). Keep human-in-the-loop confirmation before consequential actions (send/buy/delete).
- **LLM access**: **BYO Gemini key** — user pastes their own key, stored in `chrome.storage.session`, all cloud calls from the background service worker. Zero infra, ships immediately. (Nano on-device can be layered in later for free/private quick tasks.)

### Implications of these choices
- Computer Use is a **preview** model and the most complex path — expect iteration on reliability; the confirmation gate is non-negotiable for safety.
- BYO key means onboarding must clearly walk users through getting a Gemini API key; gate all features behind a valid key check.
- Hybrid shape means the architecture must cleanly separate the **agent runtime** (planning + Computer Use action loop) from the **tool apps** (stateless GenericApp-style features) — shared page-context + Gemini layer underneath.

## Still open (raise during planning)
- Target vertical for the agent's "killer" use cases, or general-purpose?
- Which 3–5 tool apps ship in v1 alongside the agent?
- Memory scope for v1 (cross-session memory is a differentiator but adds complexity).
