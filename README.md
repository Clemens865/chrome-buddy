# Chrome Buddy

> A universal **agentic + LLM** Chrome extension — model-transparent, BYO-key, privacy-respecting. One assistant that *does* multi-step browser work, not just talks about it.

Chrome Buddy is a Manifest V3 side-panel extension that combines four coexisting layers over **one shared tool registry**:

1. **Focused micro-apps** for fast, single-purpose jobs — Console Inspector, Image Generator, Audio Transcriber, **Voice Transcriber** (record → transcript → summarize / clean up / meeting notes, with live captions while you speak), Webhook Flows, Scrape to Table, Data Visualizer, Tab Manager, SVG Icon Generator.
2. **An agentic chat** with multi-step execution (plan → act → observe → reflect), a human-in-the-loop (HITL) confirmation gate before any consequential action, multi-tab context, and an opt-in **sub-agent** mode that splits a multi-phase task into a bounded, sequential sub-task queue.
3. **A natural-language app builder** that generates *real* applications with their own UI — Tier-1 declarative apps, Tier-2 sandboxed-JS apps, and **Tier-3 sandbox-UI micro-apps** that render their own DOM inside an opaque-origin iframe behind a permission-gated capability bridge. Apps live as data (export / import / edit), never as committed code.
4. **User-extensible skills + workflows** — add new capabilities as data, not code (incl. importing Claude `SKILL.md` files). Plus an MCP-server connector so the model can call into any Streamable-HTTP MCP service you trust.

**Model-transparent, BYO-key.** Default is **Google Gemini** (`gemini-2.5-flash`) via `@google/genai`, with a registry that also ships **Anthropic Claude** (Opus 4.8 / Sonnet 4.6 / Haiku 4.5) and any OpenAI-compatible endpoint. A per-app and per-chat **Cheapest / Balanced / Best** intent selector resolves the right model per call (Best → Opus when an Anthropic key is set); image / voice / vision stay pinned to Gemini.

## Status

**Active development, daily use.** 696 unit tests + 186 e2e tests passing across the major surfaces:

- Chat: Auto / Ask / Agent / Vision / Voice modes; multi-session history; streaming replies; artifact cards (code blocks → openable viewer with copy + download); attachments (images + text files); a per-chat model chip (Cheapest / Balanced / Best) that overrides the Settings default
- Multi-tab context: a composer **Tabs** picker that folds several other open tabs into a chat's context, plus conversational memory across turns
- Sub-agents (opt-in): a multi-phase Agent task is split into a sequential sub-task queue — focused context per phase, one **shared budget ledger** across the whole tree (cost / model-call / wall-clock ceilings), a no-decomposition floor so simple tasks stay on the single loop, and a visible sub-task tree in the transcript
- HITL: confirm card with approve / cancel (correlated by run + call id), sticky pending-confirm banner, plan-approval gate, ask_user inline card, resume-interrupted-run
- Apps: **9 openable built-ins** + a natural-language **app builder** — Tier-1 (declarative form + prompt), Tier-2 (sandboxed JS, review gate before first run), and Tier-3 (sandbox-UI micro-apps that render their own DOM); guided build with clarifying questions, live preview, edit / iterate, and export / import to share
- Tab Manager: list / search / dedupe / pin / suspend (free memory) / move-to-new-window / copy-URLs (Markdown · Plain · JSON), AI group-by-topic, and **Spaces** (named local workspaces you switch between)
- Skills + Workflows: create / edit / delete / import / export, import a Claude `SKILL.md`, agent-callable via `call_skill`, scheduled triggers via `chrome.alarms`, event triggers on URL patterns
- Library: local RAG (Gemini embeddings + IndexedDB) organized into **collections** (a Personal Profile, a work bucket, one per project…) with an optional per-doc note ("is a competitor") surfaced at retrieval; ingest by **file (incl. PDF), one-click page capture** (panel button + right-click "Add page to Library ▸ collection"), folder import, and auto-mirror of chats + notes; **collection-aware retrieval** — task-typed 768-dim embeddings with a self-healing re-embed migration, collection-scoped `search_library`, and three auto-context modes (always-on profile / active-this-session / manual) the agent understands
- Integrations: GitHub Contents API (read / write / list with HITL gate), webhook address book, MCP server registry (Streamable HTTP transport, per-tool include + trust controls)
- Voice: STT in the composer, full Gemini Live bidirectional voice mode with function calling

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full system architecture, and [`docs/night-test-audit.md`](docs/night-test-audit.md) for the current coverage map and an honest list of known gaps.

## Install

### Quick install (download the latest release)

1. Download the latest **`chrome-buddy-vX.Y.Z.zip`** from the
   [Releases page](https://github.com/Clemens865/chrome-buddy/releases/latest)
2. Unzip — you'll get a `chrome-buddy/` folder
3. Open `chrome://extensions` and enable **Developer mode** (toggle, top right)
4. Click **Load unpacked** and pick the `chrome-buddy/` folder
5. Click the Chrome Buddy icon to open the side panel
6. Paste a Gemini API key on the onboarding screen
   ([get one free at AI Studio](https://aistudio.google.com/apikey))

No `npm`, no toolchain — the release zip is a pre-built extension. Every tagged release builds + attaches a fresh zip automatically.

### Build from source (contributors)

```bash
git clone https://github.com/Clemens865/chrome-buddy.git
cd chrome-buddy
npm install
npm run build       # produces dist/
```

Then in Chrome:

1. Open `chrome://extensions` and enable **Developer mode**
2. Click **Load unpacked** and pick the **`dist/`** folder
3. Click the Chrome Buddy icon to open the side panel
4. Paste a Gemini API key on the onboarding screen

### Key custody

The key lives **only** in `chrome.storage.session` (in-memory, cleared on browser restart). It never enters the rendered UI, never gets written to disk, never leaves the service worker except as the `Authorization` header on the Gemini API call. See [`SECURITY.md`](SECURITY.md) for the full custody story.

## How to use

| You want to… | Mode / surface | Notes |
|---|---|---|
| Ask a quick question | **Auto** or **Ask** mode in chat | Cheap, fast, tool-less |
| Pick quality vs cost per message | Model chip in the composer | Cheapest / Balanced / Best — Best routes to Opus when an Anthropic key is set |
| Ask about several open tabs at once | **Tabs** picker in the composer | Folds the picked tabs' content into this chat's context |
| Drive the open page (click, type, navigate) | **Agent** mode | Full plan + tools loop; consequential actions gate |
| Break a big multi-phase task into steps | Agent mode + **Settings → Decompose complex tasks** | Opt-in; sequential sub-tasks share one budget; simple tasks are never split |
| Have Buddy SEE the page click-by-click | **Vision** mode | Uses Gemini Computer Use; slower, costlier |
| Voice chat | **Voice** mode | Gemini Live bidirectional audio + function calling |
| Build a real app from a description | Apps → **Build a full app** | Guided build → live preview → edit / export; Tier-1 / Tier-2 / Tier-3 |
| Scrape a page into a table / chart | Apps → Scrape to Table · Data Visualizer | CSV / JSON / page-table → table or charts |
| Manage tabs + workspaces | Apps → Tab Manager | Search / dedupe / pin / suspend / copy URLs / AI-group / Spaces |
| Save a one-shot tool you'll reuse | Skills (left rail) | Variables auto-detected from `{{placeholders}}`; import a Claude `SKILL.md` |
| Chain multiple LLM steps | Workflows (left rail) | Manual / scheduled / URL-event triggers |
| Commit to a GitHub repo | Agent mode + `github_write` | Configure PAT + default repo in Settings → GitHub |
| Send page snapshot to a webhook | Apps → Webhook Flows | One-tap, HITL-gated by default |
| Connect to an MCP server | Settings → MCP Servers | Streamable HTTP only; per-tool include + trust toggles |

## Security posture

See [`SECURITY.md`](SECURITY.md) for the full document. Headlines:

- **NFR-SEC-1: API keys live in `chrome.storage.session` only**, never in IndexedDB, never in the rendered UI, never in the bundle (the env-var path is a dev-only fallback)
- **HITL gate fires for every consequential tool** (`send_webhook`, `github_write`, `write_file`, MCP calls by default) — the user always sees a confirm card with the exact args before any external side effect
- **MV3 bright line**: zero remote code execution. Tier-1 apps are pure data (form + prompt template). Tier-2 + Tier-3 apps run user-authored JS in an opaque-origin sandboxed iframe (no `chrome.*`, no key access, no ambient network) with a permission-declared, rate-capped, HITL-gated capability bridge. Generated / imported apps are never written to the bundle and never fetched-and-run; consequential bridge capabilities are never auto-authorized
- **Bounded sub-agents**: the opt-in decompose mode runs strictly sequentially (no concurrent tab access) and shares one budget ledger — cost, model-call, and absolute wall-clock ceilings — across the whole sub-task tree, so there is no runaway-loop or budget-multiplication path
- **MCP tool descriptions are sanitized** (truncated to 200 chars, known prompt-injection cues redacted) before joining the planner prompt
- **Page content is untrusted data**, fenced in the system prompt as `<<UNTRUSTED_PAGE_DATA>>` so the model treats it as observation rather than instructions
- **Restricted URLs** (`chrome://`, Web Store, `view-source:`, `chrome-extension://`) are refused with a structured `undriveable` error rather than silently failing

## Tech stack

- **Manifest V3** Chrome extension, side panel API (Chrome 116+)
- **React 19 + TypeScript + Vite**
- **`@google/genai`** for the Gemini client (HTTP + Live API); a native **Anthropic** Messages-API adapter (Opus 4.8 / Sonnet 4.6 / Haiku 4.5) + an OpenAI-compatible adapter, behind one provider-agnostic registry
- **`idb`** for IndexedDB with a single shared schema (`src/db.ts`, currently at v12)
- **Vitest** (696 tests) + **Playwright** (186 e2e tests) for testing
- CSS-variable design system with three themes (slate / cream / graphite)

## Develop

```bash
npm install
npm run dev          # Vite dev server (rare — most work is on the built extension)
npm run build        # typecheck + production build → dist/
npm run test         # 696 unit tests
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npx playwright test  # e2e against the built extension (live tests skip without .env)
npm run icons        # regenerate the manifest PNG icons from public/icon.svg
```

For live e2e tests, copy `.env.example` to `.env` and fill in `VITE_GEMINI_API_KEY` (and optionally `GITHUB_TEST_PAT` + `GITHUB_TEST_REPO` for the GitHub live test).

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the contributor guide.

## Project layout

```
src/
  agent/           Agent runtime (plan → act → observe → reflect, HITL gate, ask_user, plan-approval); shared budget ledger; sub-task decompose spine
  apps/            Tier-1 (declarative) + Tier-2 (sandboxed code) + Tier-3 (sandbox-UI) generated app engine
  artifacts/       Code-block extraction → ArtifactCard / ArtifactView in chat
  background/      Service worker: key custody, LLM dispatch, page tools, webhook + GitHub + MCP tools
  chat/            Composer helpers (attachments, classification)
  content/         Content script (page-side overlay + extraction)
  library/         Local RAG — chunking, embedding (task-typed 768-dim), store, collections, multi-format + PDF parse, folder walk, consolidation
  llm/             Multi-provider client + registry (Gemini native, OpenAI-compat, Anthropic Messages API) + per-call model-intent resolver
  mcp/             MCP client: Streamable-HTTP transport, JSON-RPC, server registry, agent-side merger
  notes/           Notes store (quick-capture sink + agent tool)
  page/            Page-tool primitives (browser control, distill, restricted URLs, human gate)
  panel/           BuddyPanel — icon rail + header shell
  sandbox/         Tier-2 sandbox host
  sidepanel/       React entry, design-system CSS
  skills/          Skill store, editor helpers, import review
  tools/           Shared tool registry + definitions + HITL gate
  ui/              Theme tokens, icon set, primitives, BuddyMark SVG
  views/           Chat, Apps grid + app builder, Library, Settings, Onboarding, History, Skills, Workflows
    apps/          Built-in apps: Console Inspector, Image Generator, Audio + Voice Transcribers, Webhook Flows, Scrape to Table, Data Visualizer, Tab Manager, SVG Icon Generator
  voice/           STT, Gemini Live session, PCM codec
  webhookFlows/    Webhook flow store + payload composer
  webhooks/        Webhook address book (URL + headers, masked display)
  workflows/       Workflow store, schedule + event triggers

docs/
  prd/             Product requirements (vision, requirements, architecture, risks, validation)
  research/        Eight research docs (competitors, platform, models, architecture, app portfolio)
  gemini/          Notes on Gemini-specific surfaces (action items, etc.)
  night-test-audit.md  Coverage map + honest gap list
```

## Documentation

- **[Product Requirements](docs/prd/PRD.md)** — vision, FR/NFR catalog, architecture, validation
- **[Research dossier](docs/research/00-synthesis.md)** — analysis underpinning the product
- **[Security policy](SECURITY.md)** — what's in scope, key custody, disclosure
- **[Contributor guide](CONTRIBUTING.md)** — dev setup, test bar, commit style
- **[Test coverage audit](docs/night-test-audit.md)** — coverage map + known gaps

## Credits

UI design draft created with [Claude Design](https://claude.ai/design). The Console Inspector builds on [Console-Buddy](https://github.com/Clemens865/Console-Buddy) (MIT).

## License

[MIT](LICENSE) © 2026 Clemens Hönig
