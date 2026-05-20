# MicroLabs-Chrome — Technical Audit (prior extension)

> Source: `/Users/clemenshoenig/Documents/Software-Projects/MicroLabs-Chrome`
> Purpose: learn from what we already built so Chrome_Buddy improves on it.

## 1. Architecture & Stack

| Component | Details |
|-----------|---------|
| Manifest | V3 |
| Framework | React 19.2 + TypeScript 5.9 (strict) |
| Build | Vite 7 + `@vitejs/plugin-react` |
| Styling | Tailwind CSS |
| Icons | lucide-react |
| AI SDK | `@google/genai@1.35.0` |
| Other deps | jszip, edge-tts-universal, imagetracerjs |

**No** ESLint/Prettier, **no** test framework, **no** CI/CD.

## 2. Extension Structure

- **Background SW** (`src/background/background.ts`, ~446 lines): context menus, tab events, page-metadata extraction (SEO/OG/Twitter/structured data), YouTube transcript extraction, screenshot capture, API-key routing, debugger-based console logging.
- **Content script** (`src/content/selection.ts`, ~178 lines): selection tracking + workflow recording (click/input/focus/scroll), selector generation, password masking.
- **Side panel UI** (`sidepanel.html` + `src/sidepanel/App.tsx`, ~2000 lines): 64 micro-apps across 8 categories; search/history/favorites/settings/profile/integrations.
- **App framework**: `GenericApp.tsx` (DRY template), `AppRegistry.ts` (catalog), `ConfigRegistry.tsx` (170+ app configs).
- **Hooks**: `useGemini`, `usePageContext`, `useAppHistory`, `useUserProfile`, `useFavorites`, `useAppStats`, `useChatSessions`, `useIntegrations`.
- **Services**: `geminiLiveService.ts` (WebSocket Live transcription), `audioUtils.ts`, `webhookService.ts`.

## 3. Capabilities — 64 micro-apps (8 categories)

- **Page Analysis (6)**: Page Digest, Chat with Page, Advanced Chat (Search grounding), Screenshot Analyzer, Terms/Privacy Analyzer, PDF Deep Analyzer.
- **Research (11)**: Research Assistant, Deep Research, Fact Checker, Citation Generator, Source Credibility, Neighborhood Intel, Privacy Policy Diff Tracker, Docs Crawler, Multi-Site Comparator, Academic Insight, Fact Check Pro.
- **AI Agents (6)**: Web Research Agent, Competitive Analysis, Link Analyzer, Topic Monitor, Auto Browser Agent, +1.
- **Browser Tools (6)**: Tab Manager Pro, Tab Automations (rule engine), Reading Queue, Multi-Tab Scraper, Workflow Recorder, Data Table Extractor.
- **Media & Creative (9)**: YouTube Digest, Voice Notes, Page Reader (TTS), AI Image Generator (Imagen 3), SVG Icon Generator, Pixel Alchemy, Brand Studio, Audio Transcriber, Color Extract.
- **Developer Tools (14)**: Console Monitor, Tech Stack Detector, Accessibility Auditor, Vision2Code, AEO Analyzer, API Endpoint Mapper, Event Tracking Validator, CodeClone Blueprint, Error Log Parser, Feature Flag Detector, Performance Budget Enforcer, Performance Pro, Code Morph, Regex Wizard, Bug Report Writer, Schema Markup.
- **Data & Analytics (8)**: Data Visualizer, Statistical Analyzer, Sentiment Pulse, Reading Time Analyzer, + BI/monitoring.
- **Business/Sales (10+)**: Cold Outreach, Lead Extractor, CRM Lead Pusher, Competitor Price Monitor, Competitor Advertising, Competitor PRD, Social Proof Harvester, Job Application Assistant, Email Composer, Interview Question Generator.
- **Productivity (5+)**: Smart Clipboard, Meeting Transcriber (Gemini Live), Meeting Minutes, Meeting Notes→Jira, Content Repurposer.

## 4. Chrome APIs & Permissions

```json
"permissions": ["sidePanel","storage","tabs","activeTab","contextMenus","scripting","tabCapture","debugger"],
"host_permissions": ["https://generativelanguage.googleapis.com/*","wss://speech.platform.bing.com/*","<all_urls>"]
```

Uses: `sidePanel`, `contextMenus`, `tabs.*` (query/capture/remove/create/update/sendMessage), `scripting.executeScript` (incl. MAIN world for YouTube), `storage.sync` (key) + `storage.local` (data), `debugger` (console).

## 5. AI / LLM Integration

- **Provider**: Google Gemini via `@google/genai`, endpoint `generativelanguage.googleapis.com`.
- **Models**: Gemini 3 Flash Preview (text, temp 1.0, 4096 out), Gemini 2.5 Flash Image (vision), Gemini Live 2.5 Flash (audio over WebSocket `v1alpha`).
- **`useGemini.ts`**: `generateContent()` (system instruction, JSON mode, thinking levels min/low/med/high, inline images, tools: Search/Maps/URL context) + `generateWithSearch()` (grounding + sources).
- **Key storage**: `chrome.storage.sync` (BYO key via Settings). No validation, rotation, or rate limiting.

## 6. Strengths to Keep

1. **DRY app templating** — `GenericApp` + config registry covers ~80% of apps.
2. **Rich page context** extraction (meta/OG/structured data, site-type detection, reading time).
3. **Integration extensibility** — webhook abstraction (Slack/Notion/Airtable/Zapier, 9 types).
4. **User personalization** — profile injected into chat/outreach.
5. **Advanced features** — workflow recording → automation code, Live API transcription, tab rule engine.

## 7. Pain Points to Fix in Chrome_Buddy

1. **No linting / no tests / no CI** — add ESLint+Prettier+husky, Vitest, and a build/release pipeline.
2. **Sparse error handling** — ErrorBoundary only covers React; many async ops lack try/catch; failed integrations don't retry/queue.
3. **API-key security** — centralized sync key, no validation, no quota guard, risk of log exposure. Prefer `storage.session` + background-only calls (see Gemini doc §7).
4. **Over-broad permissions** — `<all_urls>` + `debugger`; scope to `http*://*` and request optional/host permissions on demand.
5. **Storage fragmentation** — per-app keys, no schema versioning/migration, hard-coded 50-item history, quota risk.
6. **Concurrency** — no locking on storage; setTimeout debounce can drop workflow events.
7. **Performance** — re-extracts ~50k chars per context update, no page-context caching, slow MAIN-world YouTube injection, SW never sleeps.
8. **Code duplication & legacy files** (`content.js` vs `content.ts`), mixed callback/promise patterns.
9. **No prompt-injection safeguards**, no rate limiting on API spend, no feature flags, no dark-mode toggle.

## Verdict
Production-grade UX polish with 64 features, but cut corners on testing, security, storage design, and code quality. Chrome_Buddy should **keep the templating + page-context + integration patterns** and **fix security, storage, error handling, permissions scope, and add tests/CI** from day one.
