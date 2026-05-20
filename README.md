# Chrome Buddy

> The best universal **agentic + LLM** Chrome extension — model-transparent, BYO-key, privacy-respecting. One assistant that *does* multi-step browser work, not just talks about it.

Chrome Buddy combines three coexisting layers over **one shared tool registry**:

1. **A suite of focused micro-apps** (Page Summarizer, Console Inspector, Image Studio, …)
2. **An agentic chat** with multi-step execution (plan → act → observe → reflect) and human-in-the-loop confirmation before any consequential action
3. **User-extensible skills + workflows** — add new tools as data, no resubmission, no remote code

Primary LLM is **Google Gemini** (`gemini-3.5-flash` default), with a registry-driven, multi-provider adapter. Bring your own key — it lives in `chrome.storage.session` and all cloud calls happen in the background service worker.

## Status

🚧 Early development. The **UI shell** (side panel, rail, chat, apps, skills/workflows/history, settings, theming) is implemented and builds. The agent runtime, real Gemini wiring, model registry, and the Tier-1/Tier-2 app systems are being built out — see [`docs/prd/`](docs/prd/) and [`docs/research/`](docs/research/).

## Tech stack

- **Manifest V3** Chrome extension (side panel)
- **React 19 + TypeScript + Vite**
- CSS-variable design system (3 themes: slate / cream / graphite)
- `@google/genai` (planned) for the LLM client

## Develop

```bash
npm install
npm run dev        # Vite dev server
npm run build      # typecheck + production build → dist/
npm run typecheck
```

### Load the unpacked extension

1. `npm run build`
2. Open `chrome://extensions`, enable **Developer mode**
3. **Load unpacked** → select the `dist/` folder
4. Click the toolbar icon to open the side panel

## Project layout

```
src/
  background/      service worker (key custody + agent orchestration — WIP)
  sidepanel/       React entry, App router, design-system CSS
  panel/           BuddyPanel — icon rail + header shell
  ui/              theme tokens, icon set, primitives
  views/           Chat, Apps grid, Skills/Workflows/History, Settings
    apps/          micro-apps: Summarizer, Console, Image
docs/
  research/        8 research docs (competitors, platform, models, architecture, app portfolio)
  prd/             full PRD (vision, journeys, 164 requirements, architecture, risks, validation)
```

## Documentation

- **[Product Requirements](docs/prd/PRD.md)** — vision, requirements, architecture, roadmap
- **[Research dossier](docs/research/00-synthesis.md)** — the analysis the product is built on

## Credits

UI design draft created with [Claude Design](https://claude.ai/design). The Console Inspector builds on [Console-Buddy](https://github.com/Clemens865/Console-Buddy) (MIT).

## License

[MIT](LICENSE) © 2026 Clemens Hönig
