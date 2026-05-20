# Chrome_Buddy — App Portfolio: Classifying the 64 MicroLabs Micro-Apps

> Decides, for every one of the 64 MicroLabs micro-apps (audit `01` §3), whether it earns a
> dedicated micro-app, lives as an agent workflow / saved skill, is a hybrid, or is subsumed
> into a bigger app. Grounded in the "one shared tool registry, three exposure levels" model
> (`06`), the product direction (`00`), and the MoSCoW/MVP→V1→V2 phasing (`prd/risks-and-priorities.md`).
>
> Anchor decisions it serves: synthesis "Still open" → *which 3–5 tool apps ship in v1*; R5
> (anti-sprawl); R13 (one-registry-three-exposures bet). Two apps are user-confirmed for v1:
> **Console Buddy** (port of an existing repo) and **Image Studio**.

---

## 1. Classification Framework

Every app gets exactly one of four verdicts:

- **OWN APP** — deserves a dedicated micro-app. Use when the capability **needs a rich non-chat UI**
  (editor / canvas / grid / charts / live monitor), is **deterministic and repeated**, is
  **stateful / persistent** (queues, rules, sessions, configs), is **real-time / streaming**,
  **handles media**, or is a **high-frequency one-shot** (used so often that a single-tap launcher
  beats typing a prompt).
- **AGENT WORKFLOW** — better delivered through the agentic chat and saved skills. Use when the task
  is **inherently multi-step / multi-tab**, **varies every time**, requires **open-ended reasoning
  over many sources**, is a **composition** of other capabilities, or is **exploratory / low-reuse**.
- **HYBRID** — exists as an app but its primary power is "hand to the agent" (every app exposes the
  Hand-to-Agent escalation, `06` §5), **or** a stateful app that also runs a scheduled agent (e.g. a
  monitor with a UI plus a background watch).
- **SUBSUMED** — folded into another app rather than shipped standalone (most dev/quality/perf tools
  collapse into **Console Buddy**; the image/brand/color/SVG tools collapse into **Image Studio**).

### Tier (the exposure level of an OWN APP)

- **T1 declarative** — pure config: input UI → prompt/pipeline → renderer, interpreted by the
  GenericApp runtime. No bespoke code (`06` §5, FR-APP-1..15).
- **T1+ custom UI** — needs bespoke components beyond the GenericApp interpreter (canvas, live
  monitor, table grid, charting, audio waveform).
- **n/a** — verdict is AGENT WORKFLOW or SUBSUMED, so no app tier applies.

### The principle that makes this safe: build the capability once, expose it three ways

Per `06` §5 and R13, there is **one Tool Registry**. A capability (e.g. "analyze the console",
"generate an image", "extract a table") is implemented **once** as a registry tool, then exposed at
three automation levels: (a) as a **micro-app** with tailored UI, (b) as a **tool the agent can
call** in a multi-step plan, and (c) as a **saved skill / workflow**. So "OWN APP" vs "AGENT
WORKFLOW" is **not** a build-twice fork — it is a decision about *the default front door*. An app and
an agent tool can be the same underlying capability. Console Buddy is the flagship proof: a dedicated
dev-tools app whose 22+ analyses **also** register as agent tools. This is the structural defense
against scope sprawl (R5): we ship few dedicated UIs, and the agent + skills cover the long tail
without re-implementing anything.

---

## 2. Full Classification Table (all 64 apps)

Grouped by the 8 MicroLabs categories from audit `01` §3. Every row gets a decisive verdict.
`v1/v2/later` = which release the *front door* appears in (the underlying capability may exist as an
agent tool earlier). Console Buddy and Image Studio are confirmed v1 (synthesis "Still open").

### Page Analysis (6)

| App | Verdict | Tier | Rationale (1 line) | Phase |
|-----|---------|------|--------------------|-------|
| Page Digest | HYBRID | T1 declarative | One-shot summarize-this-page — high-frequency launcher, but its real lift is "hand to agent: now do this for 10 pages." | v1 |
| Chat with Page | OWN APP | T1+ custom UI | Stateful conversational session over page context; needs a chat thread UI, not a one-shot pipeline. | v1 |
| Advanced Chat (Search grounding) | SUBSUMED | n/a | Same chat UI as Chat with Page with grounding toggled on — a setting, not a separate app. | v1 |
| Screenshot Analyzer | HYBRID | T1 declarative | Capture-and-ask is a fast one-shot, but visual Q&A across a flow is an agent job (feeds the agent's screenshot tool). | v1 |
| Terms/Privacy Analyzer | OWN APP | T1 declarative | Deterministic, repeated, high-value one-shot ("what am I agreeing to?") with a fixed extract→risk-flag pipeline. | v1 |
| PDF Deep Analyzer | OWN APP | T1+ custom UI | Media handling (PDF parsing, page navigation, citation jumps); needs a document-aware viewer beyond chat. | v2 |

### Research (11)

| App | Verdict | Tier | Rationale (1 line) | Phase |
|-----|---------|------|--------------------|-------|
| Research Assistant | AGENT WORKFLOW | n/a | Open-ended reasoning over many sources, varies every time — the canonical agent/skill use case. | v1 |
| Deep Research | AGENT WORKFLOW | n/a | Inherently multi-step, multi-tab, long-horizon synthesis — pure agent territory (parallel research is a V2 lift, `05`). | v1 |
| Fact Checker | HYBRID | T1 declarative | One-shot "check this claim" app, but verification across sources hands to the agent for evidence-gathering. | v1 |
| Citation Generator | OWN APP | T1 declarative | Deterministic, repeated, format-bound (BibTeX/APA/MLA) one-shot — a config pipeline, no reasoning sprawl. | v2 |
| Source Credibility | HYBRID | T1 declarative | Quick scorecard one-shot; deeper provenance tracing escalates to the agent. | v2 |
| Neighborhood Intel | AGENT WORKFLOW | n/a | Composition over Maps + web + reviews; ad-hoc, location-varying, low-reuse — a skill. | later |
| Privacy Policy Diff Tracker | HYBRID | T1+ custom UI | Stateful: stores snapshots + runs a scheduled diff watch (app UI for history + a monitor agent). | v2 |
| Docs Crawler | AGENT WORKFLOW | n/a | Multi-page crawl + synthesis — multi-tab composition, the agent's job; saveable as a skill. | v1 |
| Multi-Site Comparator | AGENT WORKFLOW | n/a | Open-ended cross-site comparison that varies every time — agent + skill, not a fixed UI. | v1 |
| Academic Insight | AGENT WORKFLOW | n/a | Research-y reasoning over papers; composition of summarize/extract/cite — a skill. | later |
| Fact Check Pro | SUBSUMED | n/a | "Pro" tier of Fact Checker — same capability, folds into it (deeper run = hand to agent). | v1 |

### AI Agents (6)

| App | Verdict | Tier | Rationale (1 line) | Phase |
|-----|---------|------|--------------------|-------|
| Web Research Agent | AGENT WORKFLOW | n/a | This *is* the core agent loop — it ceases to be a discrete app and becomes the chat home (`06` §4). | v1 |
| Competitive Analysis | AGENT WORKFLOW | n/a | Multi-tab, open-ended synthesis across competitor sites — a flagship saved skill (Scenario S1 lineage). | v1 |
| Link Analyzer | HYBRID | T1 declarative | Quick "what's behind these links" one-shot; bulk crawl + classify hands to the agent. | v2 |
| Topic Monitor | HYBRID | T1+ custom UI | Stateful watchlist UI + scheduled agent run on a trigger — the canonical app-plus-monitor hybrid. | v2 |
| Auto Browser Agent | AGENT WORKFLOW | n/a | Arbitrary UI automation = the Computer-Use agent itself, not a separate app. | v1 |
| Workflow/Task Agent (+1) | AGENT WORKFLOW | n/a | Generic task runner — subsumed into the agent + workflow system. | v1 |

### Browser Tools (6)

| App | Verdict | Tier | Rationale (1 line) | Phase |
|-----|---------|------|--------------------|-------|
| Tab Manager Pro | OWN APP | T1+ custom UI | Real-time stateful grid of live tabs (group/close/save); a live management surface, not a prompt. | v2 |
| Tab Automations (rule engine) | OWN APP | T1+ custom UI | Persistent rule store + event triggers; a stateful rules editor that also fires scheduled agent actions. | v2 |
| Reading Queue | OWN APP | T1+ custom UI | Stateful persistent queue with list UI, ordering, read/unread state — classic stateful app. | v2 |
| Multi-Tab Scraper | HYBRID | T1+ custom UI | Structured extraction across tabs with a results grid; bulk/varying scrape hands to the agent. | v2 |
| Workflow Recorder | OWN APP | T1+ custom UI | Records clicks/inputs → generates steps; a recorder UI feeding the workflow builder (`06` §3, V2). | v2 |
| Data Table Extractor | HYBRID | T1+ custom UI | Deterministic table→grid one-shot (own app) that also registers `extract` as an agent tool. | v1 |

### Media & Creative (9)

| App | Verdict | Tier | Rationale (1 line) | Phase |
|-----|---------|------|--------------------|-------|
| YouTube Digest | OWN APP | T1+ custom UI | Media handling (transcript extraction + timestamps); high-frequency one-shot with a chaptered viewer. | v1 |
| Voice Notes | OWN APP | T1+ custom UI | Real-time audio capture + STT; needs a recorder/waveform UI and offscreen audio (`04`). | v2 |
| Page Reader (TTS) | OWN APP | T1+ custom UI | Streaming audio playback with player controls — real-time media, not a prompt pipeline. | v2 |
| AI Image Generator (Imagen) | SUBSUMED | n/a | Folds into Image Studio (the generate_image capability). | v1 |
| SVG Icon Generator | SUBSUMED | n/a | Folds into Image Studio (vector/icon output mode). | v1 |
| Pixel Alchemy | SUBSUMED | n/a | Image editing — folds into Image Studio's canvas editor + edit_image. | v1 |
| Brand Studio | SUBSUMED | n/a | Brand-asset generation — folds into Image Studio (templated generation). | v2 |
| Audio Transcriber | OWN APP | T1+ custom UI | Media handling: upload/record audio → transcript; needs file/audio UI. (Shares Voice Notes' STT.) | v2 |
| Color Extract | SUBSUMED | n/a | Palette extraction from an image — folds into Image Studio as an editor tool. | v1 |

### Developer Tools (16)

| App | Verdict | Tier | Rationale (1 line) | Phase |
|-----|---------|------|--------------------|-------|
| Console Monitor | SUBSUMED | n/a | Console capture/analysis → a Console Buddy tool (its core Debug capability). | v1 |
| Tech Stack Detector | SUBSUMED | n/a | Stack fingerprinting → a Console Buddy analysis tool. | v1 |
| Accessibility Auditor | SUBSUMED | n/a | a11y audit → Console Buddy's Page-Quality tool group. | v1 |
| Vision2Code | AGENT WORKFLOW | n/a | Screenshot → code generation; open-ended multimodal generation, varies every time — a skill. | v2 |
| AEO Analyzer | SUBSUMED | n/a | Answer-engine-optimization audit → Console Buddy Page-Quality. | v2 |
| API Endpoint Mapper | SUBSUMED | n/a | Network endpoint discovery → Console Buddy Network tool. | v1 |
| Event Tracking Validator | SUBSUMED | n/a | Analytics/event QA → Console Buddy Network/Quality tool. | v1 |
| CodeClone Blueprint | AGENT WORKFLOW | n/a | "Clone this site/component" — open-ended multi-step generation; a skill, not a fixed app. | later |
| Error Log Parser | SUBSUMED | n/a | Log parsing/clustering → Console Buddy Debug tool. | v1 |
| Feature Flag Detector | SUBSUMED | n/a | Flag detection → Console Buddy analysis tool. | v2 |
| Performance Budget Enforcer | SUBSUMED | n/a | Perf-budget checks → Console Buddy Performance group. | v2 |
| Performance Pro | SUBSUMED | n/a | Core Web Vitals / perf profiling → Console Buddy Performance group. | v1 |
| Code Morph | AGENT WORKFLOW | n/a | Code transformation/refactor — open-ended reasoning over arbitrary input; a skill. | later |
| Regex Wizard | OWN APP | T1 declarative | Deterministic, high-frequency one-shot (describe→regex→test); a tight config pipeline. | v2 |
| Bug Report Writer | OWN APP | T1 declarative | Deterministic templated one-shot (context→structured report); pairs with Console Buddy output. | v2 |
| Schema Markup | SUBSUMED | n/a | Structured-data / schema.org validation → Console Buddy Page-Quality / SEO tool. | v2 |

### Data & Analytics (8)

| App | Verdict | Tier | Rationale (1 line) | Phase |
|-----|---------|------|--------------------|-------|
| Data Visualizer | OWN APP | T1+ custom UI | Renders charts from extracted data — needs a charting canvas, deterministic and repeated. | v2 |
| Statistical Analyzer | OWN APP | T1 declarative | Deterministic stats over a dataset with a fixed output renderer; repeated one-shot. | later |
| Sentiment Pulse | HYBRID | T1 declarative | Quick sentiment one-shot (app); bulk/longitudinal sentiment over many pages hands to the agent. | v2 |
| Reading Time Analyzer | SUBSUMED | n/a | Trivial derived metric — folds into PageContext / Page Digest, not a standalone app. | v1 |
| BI Dashboard (data app) | AGENT WORKFLOW | n/a | Open-ended "analyze this data and tell me what matters" — composition; a skill. | later |
| Monitoring (data app) | HYBRID | T1+ custom UI | Stateful metric watch UI + scheduled agent run — app-plus-monitor hybrid. | later |
| Trend Analyzer (data app) | AGENT WORKFLOW | n/a | Multi-source longitudinal reasoning that varies every time — a skill. | later |
| Report Builder (data app) | AGENT WORKFLOW | n/a | Composes extract+analyze+format across sources — a saved skill/workflow. | later |

### Business / Sales (10)

| App | Verdict | Tier | Rationale (1 line) | Phase |
|-----|---------|------|--------------------|-------|
| Cold Outreach | OWN APP | T1 declarative | Deterministic templated generation with profile injection; high-frequency, repeated one-shot. | v2 |
| Lead Extractor | HYBRID | T1+ custom UI | Structured extraction → results grid (own app) that also feeds the agent's `extract` tool for bulk runs. | v2 |
| CRM Lead Pusher | HYBRID | T1 declarative | Deterministic push to CRM (app + webhook); consequential, so the agent gates it via HITL when chained. | v2 |
| Competitor Price Monitor | HYBRID | T1+ custom UI | Stateful watchlist UI + scheduled agent watch — the Scenario S1 / monitor archetype. | v2 |
| Competitor Advertising | AGENT WORKFLOW | n/a | Open-ended cross-site/ad-library research that varies every time — a skill. | later |
| Competitor PRD | AGENT WORKFLOW | n/a | Long-horizon synthesis into a document — composition over many sources; a skill. | later |
| Social Proof Harvester | HYBRID | T1+ custom UI | Extract testimonials/reviews to a grid (app); broad multi-site harvest hands to the agent. | later |
| Job Application Assistant | AGENT WORKFLOW | n/a | Multi-step, multi-site, varies per posting (read JD → tailor → fill form) — agent + skill. | v2 |
| Email Composer | OWN APP | T1 declarative | High-frequency deterministic generation with tone control + profile; a tight one-shot. | v2 |
| Interview Question Generator | OWN APP | T1 declarative | Deterministic templated one-shot from a role/JD; repeated, fixed pipeline. | later |

### Productivity (5)

| App | Verdict | Tier | Rationale (1 line) | Phase |
|-----|---------|------|--------------------|-------|
| Smart Clipboard | OWN APP | T1+ custom UI | Stateful persistent clip store with list UI + transforms; always-available utility. | v2 |
| Meeting Transcriber (Gemini Live) | OWN APP | T1+ custom UI | Real-time streaming audio over WebSocket (Live API); needs a live session UI + offscreen capture. | v2 |
| Meeting Minutes | HYBRID | T1 declarative | Deterministic transcript→minutes one-shot; distribution/follow-ups hand to the agent. | v2 |
| Meeting Notes → Jira | HYBRID | T1 declarative | Deterministic transform + consequential push (webhook/HITL); chains into the agent for ticket creation. | later |
| Content Repurposer | AGENT WORKFLOW | n/a | Open-ended "turn this into N formats for N channels" — composition that varies; a saved skill. | v2 |

**Tally:** 64 apps classified — Page Analysis 6, Research 11, AI Agents 6, Browser Tools 6, Media & Creative 9, Developer Tools 16, Data & Analytics 8, Business/Sales 10, Productivity 5 (the audit's headline "64" with category overlaps reconciled to the named apps in `01` §3). Verdict spread: **OWN APP 19**, **HYBRID 16**, **AGENT WORKFLOW 19**, **SUBSUMED 12** — roughly a third folded away or handed to the agent, the anti-sprawl signal R5 wants.

---

## 3. Consolidation Map

Two big absorbers collapse the long tail of overlapping tools into two flagship apps. This is the
concrete expression of R5 (anti-sprawl) and the "build once, expose three ways" rule — each absorbed
tool becomes a registry tool inside the host app, not a separate codebase.

### (a) Console Buddy absorbs the dev / quality / perf / security tools

```
                         ┌──────────────── CONSOLE BUDDY (App #1) ────────────────┐
  Console Monitor ──────►│ Debug:        console capture, Error Log Parser         │
  Error Log Parser ─────►│                                                         │
  API Endpoint Mapper ──►│ Network:      endpoint map, Event Tracking Validator    │
  Event Tracking Valid ─►│                                                         │
  Performance Pro ──────►│ Performance:  Core Web Vitals, Performance Budget       │
  Performance Budget ───►│                                                         │
  Accessibility Auditor►│ Page-Quality: a11y, Schema Markup, AEO Analyzer          │
  Schema Markup ────────►│                                                         │
  AEO Analyzer ─────────►│ Detect:       Tech Stack, Feature Flag Detector         │
  Tech Stack Detector ──►│                                                         │
  Feature Flag Detector►│  (22+ analysis tools across Debug/Network/Security/      │
                         │   Performance/Page-Quality, all registered as agent     │
                         │   tools — see §5)                                       │
                         └─────────────────────────────────────────────────────────┘
```

10 MicroLabs apps → one app's tool groups. (Vision2Code, CodeClone, Code Morph stay AGENT WORKFLOWS —
they are open-ended *generation*, not analysis. Regex Wizard and Bug Report Writer stay small OWN
APPS — different jobs, though Bug Report Writer consumes Console Buddy output.)

### (b) Image Studio absorbs the image / brand / color / vector tools

```
                         ┌──────────────── IMAGE STUDIO (App #2) ─────────────────┐
  AI Image Generator ───►│ Generate:  Imagen 4 / Nano Banana (gemini-2.5-flash-img)│
  SVG Icon Generator ───►│            + vector/icon output mode                    │
  Pixel Alchemy ────────►│ Edit:      canvas crop/adjust + "edit with AI"          │
  Brand Studio ─────────►│            (Nano Banana edit/inpaint), brand templates  │
  Color Extract ────────►│ Tools:     palette extraction from image                │
                         │  (registers generate_image + edit_image as agent tools) │
                         └─────────────────────────────────────────────────────────┘
```

5 MicroLabs apps → one media flagship.

### What stays standalone (not absorbed)

- **Chat with Page** (+ Advanced Chat folded in as a grounding toggle) — the page-conversation surface.
- **Page Digest, Terms/Privacy Analyzer, Fact Checker** — distinct high-value one-shots.
- **PDF Deep Analyzer, YouTube Digest** — media-specific viewers.
- **Voice Notes / Audio Transcriber / Meeting Transcriber / Page Reader** — the audio cluster (share
  one STT/TTS service but have different UIs; could later consolidate into a single "Audio" app).
- **Tab Manager Pro, Tab Automations, Reading Queue, Workflow Recorder** — the browser-state cluster.
- **Data Visualizer, Statistical Analyzer** — the data-output cluster.
- **Cold Outreach, Email Composer, Lead Extractor, CRM Lead Pusher, Competitor Price Monitor** — the
  business cluster (generation + monitor + extract).
- **Regex Wizard, Bug Report Writer, Smart Clipboard, Citation Generator** — small standalone utilities.

---

## 4. The v1 Micro-App Shortlist

~8 dedicated apps for the V1 public release — chosen for highest value, agent-complementarity, and
because they genuinely *need* an app (rich UI, state, media, or high-frequency one-shot) rather than a
prompt. **Must include the two confirmed apps.** Everything else rides the agent + skills.

| # | App | What it does | Tier | Why an app, not a workflow |
|---|-----|--------------|------|----------------------------|
| 1 | **Console Buddy** (confirmed) | Dev/quality/perf/security analysis of the current page (22+ tools) + Agent Mode report. | T1+ custom UI | Rich tabbed tool UI + live monitors + exportable reports; deterministic, repeated; flagship "own app that also exposes agent tools." |
| 2 | **Image Studio** (confirmed) | Generate images (Imagen 4 / Nano Banana) + canvas edit + edit-with-AI. | T1+ custom UI | Canvas editor + prompt bar + reference-image mixing — media handling that chat can't render. |
| 3 | **Chat with Page** | Stateful conversation grounded in the current page (Advanced Chat = grounding toggle). | T1+ custom UI | Persistent thread state per page; the table-stakes surface every competitor has. |
| 4 | **Page Digest** | One-tap summarize this page/selection, with Hand-to-Agent. | T1 declarative | Highest-frequency one-shot; a launcher beats typing a prompt every time. |
| 5 | **Terms/Privacy Analyzer** | Extract + risk-flag a ToS/privacy page. | T1 declarative | Deterministic, repeated, high-value; fixed pipeline, instant value, needs no agent. |
| 6 | **YouTube Digest** | Transcript extraction → chaptered summary with timestamps. | T1+ custom UI | Media handling + timestamp navigation UI; very high-frequency one-shot. |
| 7 | **Data Table Extractor** | Pull tables/structured data from a page into an editable grid → export. | T1+ custom UI | Grid UI + deterministic extract; also registers `extract` as the agent's table tool. |
| 8 | **Fact Checker** | One-shot claim check with sources; Hand-to-Agent for deep verification. | T1 declarative | Fast deterministic check is an app; the deep multi-source run is the agent (clean hybrid). |

This proves the "one registry, three exposures" bet (R13) across real UIs while staying small enough
to dodge sprawl. Apps 4, 5, 8 are essentially-free T1 configs on the GenericApp runtime; the cost is
concentrated in Console Buddy, Image Studio, Chat, and the two grid/media UIs.

---

## 5. Confirmed v1 App Specs

### Console Buddy (App #1 — port of an existing repo)

**Source:** `github.com/Clemens865/Console-Buddy` — MIT, already built. React 18 + TypeScript + Vite,
Manifest V3, side panel. **22+ analysis tools** across Debug / Network / Security / Performance /
Page-Quality. Has an **Agent Mode** that runs all tools with progress + exportable reports
(HTML / MD / JSON), multi-provider AI (Claude / OpenAI / Gemini), and uses
`debugger` + `scripting` + `tabs` + `storage` + `sidePanel`.

This is the **flagship example of an "own app" that ALSO exposes agent tools** — the living proof of
R13's "one registry, three exposures."

**Integration into Chrome_Buddy:**

- **Register capabilities into the shared Tool Registry.** Each of the 22+ analyses becomes a registry
  tool (`analyze_console`, `map_network`, `audit_a11y`, `check_perf`, `scan_security`, …) with a
  machine-readable schema (FR-TOOLS-13). The app UI and the agent then both call the *same* tools — so
  the agent can do "open this page, run the security + perf scan, and email me the failures" without
  re-implementing analysis. Console Buddy's own **Agent Mode** (run-all + report) maps onto a saved
  Chrome_Buddy **skill** ("full site health report") that fans out across these tools.
- **Reuse the lazy-loaded tool components.** Port them as the app's tab groups (Debug / Network /
  Security / Performance / Page-Quality). Keep lazy loading so the side panel stays light (perf, `01`
  §7).
- **Reconcile multi-provider config with the registry-driven LLM client.** Console Buddy ships its own
  Claude/OpenAI/Gemini selector; Chrome_Buddy has **one** shared LLM client (BYO key in
  `storage.session`, all calls from the SW — `00` architecture rule, NFR-SEC-1/2). **Drop Console
  Buddy's standalone provider config**; route every model call through Chrome_Buddy's
  registry-driven client and model registry (FR-MR-*). Chrome_Buddy's OpenAI-compatible adapter
  (FR-MR-9, V1) preserves Console Buddy's multi-provider reach without a second key store.
- **`debugger` permission / banner tradeoff (cross-ref `04`).** Console Buddy relies on
  `chrome.debugger` (CDP) for full console/network capture, which triggers the un-hideable "extension
  is debugging this browser" banner (R11, `04` §3). Apply Chrome_Buddy's **hybrid rule**:
  `scripting` synthetic reads by default (no banner) and **activate CDP only when full
  console/network trace is genuinely required**, with a proactive in-app note that the banner is
  expected (FR-BC-1/2/3). Make `debugger` an **optional, on-demand** permission requested when the
  user opens a Console Buddy tool that needs it — not a default in the manifest (R11, NFR-SEC-7).
- **Tier:** T1+ custom UI. **Outputs** (HTML/MD/JSON reports) save to the FSA root folder (`04` §2,
  FR-FS-*) and/or download.

### Image Studio (App #2)

**What it does:** Image generation + basic editing in the side panel.

- **Generation:** Gemini **Imagen 4** (`imagen-4...`) and **Nano Banana**
  (`gemini-2.5-flash-image`) per `03` §4. Imagen for high-fidelity, Nano Banana for
  cheap/high-volume gen + native editing.
- **Editing:** upload a photo → **crop + basic adjustments via Canvas** → **"edit with AI"**
  (Nano Banana image editing / inpainting). Reference-image mixing (drop in 1–N images to condition
  generation).

**Spec:**

- **UI:** a **canvas editor** (crop, rotate, brightness/contrast, mask-for-inpaint) + a **prompt bar**
  (generate / edit instruction) + a **reference-image tray** for mixing. T1+ custom UI — canvas work
  is beyond the GenericApp interpreter.
- **Tools it registers:** `generate_image(prompt, refs?, model?)` and
  `edit_image(image, instruction|mask, model?)` — so the agent can call image gen/edit inside a plan
  ("make a hero image for each of these 5 product pages and save them").
- **Where outputs save:** the **FSA root folder** (`04` §2; one folder pick on first save, persistent
  perms on Chrome 122+, FR-FS-2/3) — e.g. `Chrome_Buddy/images/`. Fallback to downloads.
- **Absorbs over time:** **AI Image Generator** (now), **Color Extract** (palette tool, v1),
  **Pixel Alchemy** (canvas edit, v1), **SVG Icon Generator** (vector output mode, v1), **Brand
  Studio** (templated brand-asset generation, v2). Each becomes a mode/tool inside Image Studio rather
  than a separate app.
- **Phasing note:** the broader media suite (TTS, full image edit) is V2 in `prd` MoSCoW
  (FR-MEDIA-2/3/4); Image Studio ships in v1 as a confirmed app with generate + basic edit, and
  deepens its edit/brand modes into V2.

---

## 6. What Becomes Agent Workflows

These capabilities ship through the **agentic chat + saved skills**, not as dedicated apps — they are
multi-step, multi-tab, varying, open-ended, or compositional, so a fixed UI would constrain more than
it helps. Each is **saveable as a shareable skill** (description always in context, body on demand,
`allowedTools` whitelist — `06` §1; import/export with consent — FR-SKILL-*).

- **Research Assistant / Deep Research / Academic Insight** — open-ended source synthesis; Deep
  Research is the parallel-research V2 differentiator (`05`).
- **Multi-Site Comparator / Docs Crawler** — multi-tab crawl + compare, varies every run.
- **Competitive Analysis / Competitor Advertising / Competitor PRD** — cross-site intelligence
  composed into a document (Competitive Analysis is the Scenario S1 flagship skill).
- **Web Research Agent / Auto Browser Agent / Workflow Task Agent** — these *are* the core agent loop,
  not separate apps.
- **Neighborhood Intel** — composition over Maps + web + reviews.
- **Vision2Code / CodeClone Blueprint / Code Morph** — open-ended code *generation/transformation*.
- **Job Application Assistant** — read JD → tailor → fill, different every posting.
- **Content Repurposer** — "turn this into N formats for N channels."
- **BI Dashboard / Trend Analyzer / Report Builder** (data) — open-ended analysis + composed reports.

These deliberately have **low reuse as fixed UIs but high reuse as parameterized skills** — exactly
what the skill system (`06` §1, §3) exists to capture. A user who runs "competitor analysis" twice
saves it as a skill the third time; a skill + trigger = a scheduled workflow (V1).

---

## 7. Recommendations

1. **Ship ~8 dedicated apps in v1, not 64.** The §4 shortlist (Console Buddy, Image Studio, Chat with
   Page, Page Digest, Terms/Privacy Analyzer, YouTube Digest, Data Table Extractor, Fact Checker) is
   the focused surface. Five of these are cheap T1 configs or shared-service viewers; cost concentrates
   in two flagships.
2. **Dev-tools flagship = Console Buddy.** Port the MIT repo, register its 22+ analyses as agent tools,
   route its multi-provider config through Chrome_Buddy's one LLM client, and make `debugger`
   optional/on-demand to dodge the banner (R11). It absorbs 10 MicroLabs dev/quality/perf tools and is
   the proof-of-concept for "own app that also exposes agent tools" (R13).
3. **Media flagship = Image Studio.** Generate (Imagen 4 / Nano Banana) + canvas edit + edit-with-AI,
   registering `generate_image` / `edit_image`. It absorbs 5 MicroLabs image/brand/color/SVG apps over
   v1→v2.
4. **The agent covers the long tail.** All research, deep-research, multi-site, competitor, docs-crawl,
   code-generation, and content-repurposing capabilities are agent workflows + saved skills — built
   once as registry tools, never as 64 hand-built UIs. This is the structural anti-sprawl move (R5):
   ~19 OWN APPS exist as *possible* front doors, but only ~8 ship in v1; the rest arrive in v2/later or
   live purely as skills.
5. **Use the four-verdict discipline as the gate for any new app request.** If a proposed feature is
   multi-step / varying / open-ended → it's a skill, not an app. If it overlaps Console Buddy or Image
   Studio → it's a tool inside them, not a new app. Only rich-UI / stateful / media / high-frequency
   one-shots earn a dedicated app. This keeps the suite focused as it grows (R5, vision anti-goal #1).

**Net:** two flagships (Console Buddy, Image Studio) + a handful of high-frequency one-shots and
stateful surfaces = a tight, coherent app suite, with the agent + shareable skills absorbing
everything that varies. Build the capability once; expose it as app, tool, and skill.
