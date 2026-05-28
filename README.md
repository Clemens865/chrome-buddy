# Chrome Buddy

> A universal **agentic + LLM** Chrome extension — model-transparent, BYO-key, privacy-respecting. One assistant that *does* multi-step browser work, not just talks about it.

Chrome Buddy is a Manifest V3 side-panel extension that combines three coexisting layers over **one shared tool registry**:

1. **Focused micro-apps** for fast, single-purpose jobs (Console Inspector, Image Generator, Audio Transcriber, Live Transcriber, Webhook Flows).
2. **An agentic chat** with multi-step execution (plan → act → observe → reflect) and a human-in-the-loop (HITL) confirmation gate before any consequential action.
3. **User-extensible skills + workflows** — add new capabilities as data, not code. Plus an MCP-server connector so the model can call into any Streamable-HTTP MCP service you trust.

Default model is **Google Gemini** (`gemini-2.5-flash`) via `@google/genai`. The registry is multi-provider so you can swap in OpenAI-compatible models without rebuilding.

## Status

**Active development, daily use.** 519 unit tests + 134 e2e tests passing across the major surfaces:

- Chat: Auto / Ask / Agent / Vision / Voice modes; multi-session history; streaming replies; artifact cards (code blocks → openable viewer with copy + download); attachments (images + text files)
- HITL: confirm card with approve/cancel, sticky pending-confirm banner, plan-approval gate, ask_user inline card, resume-interrupted-run
- Apps: 5 openable built-ins + a natural-language app generator (Tier-1 declarative form + prompt template, Tier-2 sandboxed JS code apps with a review gate before first run)
- Skills + Workflows: create / edit / delete / import / export, agent-callable via `call_skill`, scheduled triggers via `chrome.alarms`, event triggers on URL patterns
- Library: local RAG (Gemini embeddings + IndexedDB), auto-mirror of chats + notes, folder import via the File System Access API
- Integrations: GitHub Contents API (read/write/list with HITL gate), webhook address book, MCP server registry (Streamable HTTP transport, per-tool include + trust controls)
- Voice: STT in the composer, full Gemini Live bidirectional voice mode with function calling

See [`docs/night-test-audit.md`](docs/night-test-audit.md) for the current coverage map and a honest list of known gaps.

## Install (developer / unpacked)

```bash
npm install
npm run build
```

Then in Chrome:

1. Open `chrome://extensions` and enable **Developer mode**
2. Click **Load unpacked** and pick the `dist/` folder
3. Click the Chrome Buddy icon to open the side panel
4. Paste a Gemini API key on the onboarding screen ([get one free at AI Studio](https://aistudio.google.com/apikey))

The key lives **only** in `chrome.storage.session` (in-memory, cleared on browser restart). It never enters the rendered UI, never gets written to disk, never leaves the service worker except as the `Authorization` header on the Gemini API call.

## How to use

| You want to… | Mode / surface | Notes |
|---|---|---|
| Ask a quick question | **Auto** or **Ask** mode in chat | Cheap, fast, tool-less |
| Drive the open page (click, type, navigate) | **Agent** mode | Full plan + tools loop; consequential actions gate |
| Have Buddy SEE the page click-by-click | **Vision** mode | Uses Gemini Computer Use; slower, costlier |
| Voice chat | **Voice** mode | Gemini Live bidirectional audio + function calling |
| Save a one-shot tool you'll reuse | Skills (left rail) | Variables auto-detected from `{{placeholders}}` |
| Chain multiple LLM steps | Workflows (left rail) | Manual / scheduled / URL-event triggers |
| Commit to a GitHub repo | Agent mode + `github_write` | Configure PAT + default repo in Settings → GitHub |
| Send page snapshot to a webhook | Apps → Webhook Flows | One-tap, HITL-gated by default |
| Connect to an MCP server | Settings → MCP Servers | Streamable HTTP only; per-tool include + trust toggles |

## Security posture

See [`SECURITY.md`](SECURITY.md) for the full document. Headlines:

- **NFR-SEC-1: API keys live in `chrome.storage.session` only**, never in IndexedDB, never in the rendered UI, never in the bundle (the env-var path is a dev-only fallback)
- **HITL gate fires for every consequential tool** (`send_webhook`, `github_write`, `write_file`, MCP calls by default) — the user always sees a confirm card with the exact args before any external side effect
- **MV3 bright line**: zero remote code execution. Tier-1 apps are pure data (form + prompt template). Tier-2 apps run user-authored JS in an opaque-origin sandboxed iframe with a permission-aware capability bridge
- **MCP tool descriptions are sanitized** (truncated to 200 chars, known prompt-injection cues redacted) before joining the planner prompt
- **Page content is untrusted data**, fenced in the system prompt as `<<UNTRUSTED_PAGE_DATA>>` so the model treats it as observation rather than instructions
- **Restricted URLs** (`chrome://`, Web Store, `view-source:`, `chrome-extension://`) are refused with a structured `undriveable` error rather than silently failing

## Tech stack

- **Manifest V3** Chrome extension, side panel API (Chrome 116+)
- **React 19 + TypeScript + Vite**
- **`@google/genai`** for the Gemini client (HTTP + Live API)
- **`idb`** for IndexedDB with a single shared schema (`src/db.ts`, currently at v12)
- **Vitest** (519 tests) + **Playwright** (134 e2e tests) for testing
- CSS-variable design system with three themes (slate / cream / graphite)

## Develop

```bash
npm install
npm run dev          # Vite dev server (rare — most work is on the built extension)
npm run build        # typecheck + production build → dist/
npm run test         # 519 unit tests
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
  agent/           Agent runtime (plan → act → observe → reflect, HITL gate, ask_user, plan-approval)
  apps/            Tier-1 (declarative) + Tier-2 (sandboxed code) generated app engine
  artifacts/       Code-block extraction → ArtifactCard / ArtifactView in chat
  background/      Service worker: key custody, LLM dispatch, page tools, webhook + GitHub + MCP tools
  chat/            Composer helpers (attachments, classification)
  content/         Content script (page-side overlay + extraction)
  library/         Local RAG — chunking, embedding, store, folder walk
  llm/             Multi-provider client + registry (Gemini native, OpenAI-compat, Anthropic adapter stub)
  mcp/             MCP client: Streamable-HTTP transport, JSON-RPC, server registry, agent-side merger
  notes/           Notes store (quick-capture sink + agent tool)
  page/            Page-tool primitives (browser control, distill, restricted URLs, human gate)
  panel/           BuddyPanel — icon rail + header shell
  sandbox/         Tier-2 sandbox host
  sidepanel/       React entry, design-system CSS
  skills/          Skill store, editor helpers, import review
  tools/           Shared tool registry + definitions + HITL gate
  ui/              Theme tokens, icon set, primitives, BuddyMark SVG
  views/           Chat, Apps grid, Library, Settings, Onboarding, History, Skills, Workflows
    apps/          Built-in apps: Console Inspector, Image Generator, Transcribers, Webhook Flows
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
