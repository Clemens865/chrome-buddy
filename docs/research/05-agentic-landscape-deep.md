# Agentic Browser Tools — Deep Landscape (2026)

> Wider scan beyond the 15 mainstream assistants in [`02`](./02-competitor-landscape.md). Focus: cutting-edge agentic / browser-automation tools, open-source frameworks, and AI-native browsers.

## Agentic extensions & frameworks

| Tool | Type | OSS / License | Control method | Loop / agents | Models | Recovery | Pricing |
|---|---|---|---|---|---|---|---|
| **browser-use** | Py framework | MIT (~79k★) | Hybrid: a11y tree + screenshot + Set-of-Marks → Playwright | single loop + history | any | retry/backoff, alt-element | free OSS / cloud |
| **Stagehand v3** | TS/Py SDK | MIT (~50k★) | **CDP-native**: a11y tree + DOM + network | act/extract/observe/agent | any + CUA | self-healing on DOM shift | free OSS / Browserbase |
| **Skyvern** | Py + cloud | AGPL-3.0 | vision + LLM, selector-free | multi-agent swarm | pluggable | vision re-parse | free self-host / usage |
| **Nanobrowser** | **Chrome ext** | Apache-2.0 | DOM actions | Planner/Navigator/Validator | BYO (any) | Validator agent | free (BYO key) |
| **Agent-E** | Py framework | OSS | text-only **DOM distillation** | hierarchical | GPT-class | change observation | free / API |
| **LaVague** | Py framework | OSS | compile to Selenium/Playwright | World Model + Action Engine | GPT-4o (swap) | regenerate code | free |
| **Taxy AI** | Chrome ext | OSS | simplified DOM + element IDs | single (≤50 actions) | GPT (BYO) | minimal (preview) | free |
| **Eko (Fellou)** | JS agent fw | OSS | shadow-browser parallel | multi-agent | multi | re-plan | free |
| **Steel.dev** | browser infra | Apache-2.0 (~6.8k★) | CDP API (no agent) | substrate | n/a | session persistence | free self-host |
| **Anthropic Computer Use** | API/desktop | API (open ref) | vision screenshots (CUA) | single CUA | Claude | permission prompts | token/sub |
| **rtrvr.ai / doBrowser / Autobrowser** | Chrome ext | closed | DOM-intel / CUA | varies | varies | varies | freemium |

## AI-native browsers & browser agents (what extensions compete with)
- **OpenAI Operator / ChatGPT Atlas** — CUA (vision) agent mode, closed, paid. Operator ~38% OSWorld.
- **Perplexity Comet** — cross-tab agentic, ~48% of tracked agentic web traffic early 2026; free + $20 Pro.
- **The Browser Company — Dia** — AI-native browser.
- **Fellou + Manus** — deep-research frontier: parallel shadow/cloud browsers, logged-in sites, background long-running runs, report deliverables.
- **Google Project Mariner** (Gemini 2.0, 83.5% WebVoyager) — **shut down**; Google folding agentic into Gemini-in-Chrome.
- **Genspark AI Browser**, **Microsoft Copilot Mode (Edge)**.

## Premium assistant extensions (newer)
Monica, MaxAI, Sider (latest, Group AI Chat + Wisebase memory), Glarity, Wiseone, TinaMind. Mostly multi-model sidebars; Sider added a browser-agent + persistent memory.

## How the best ones implement multi-step control

**Three perception families (converging on hybrid):**
1. **DOM / accessibility-tree (text-only)** — prune page to interactive+semantic elements, assign integer IDs, feed simplified DOM, map IDs back to handles. Agent-E's **DOM Distillation** hit **73.1% WebVoyager with NO vision**. Cheap, fast, stable refs (CDP backend node IDs persist across snapshots). Misses canvas/visual UIs.
2. **Vision / screenshot (Set-of-Marks)** — screenshot + numbered bounding boxes, vision model picks a number/coordinate. Anthropic CU, OpenAI CUA/Atlas, Mariner, Skyvern. Works on anything visible, selector-free, but slow, expensive, error-prone, privacy-invasive (why Mariner was killed; industry drifting back to DOM/API).
3. **Hybrid (current default)** — **browser-use**: each loop captures screenshot + filtered a11y tree + Set-of-Marks → LLM gets visual layout *and* reliable handles → Playwright actions. **Stagehand v3** went CDP-native (dropped Playwright), adds **action/element caching** (replay at zero LLM cost) + **self-healing** (re-invoke model only when DOM shifts).

**Planner/Executor separation:** Nanobrowser = Planner+Navigator+Validator. Skyvern = decompose→parallel→aggregate. LaVague = World Model + Action Engine. Manus/Fellou = sub-agents + parallel shadow browsers.

**Failure recovery (the real differentiator):** action history fed back to break loops; retry-with-backoff + alternative-element fallback + wait-for-load; "change observation" (verify page actually changed); self-healing re-plan only on DOM shift; a Validator agent re-checking results; human-in-the-loop pause/approve before sensitive actions.

## State of the art for "research → open → screenshot → analyze → act"
- **Fellou / Manus** = frontier (parallel browsers, logged-in sites, background runs, report outputs). **Comet** owns consumer mindshare.
- Raw capability: best CUA (Claude Sonnet 4.6) ~**72.5% OSWorld ≈ human parity**; but ~1-in-4 complex real flows still fail (CAPTCHAs, JS checkout, sessions) — the failure mode that sank Operator and Mariner.
- Clear pivot: away from pure-vision (expensive/brittle/privacy-heavy) → **DOM/accessibility + API-first**, vision as fallback.

## Reusable open-source spine (what we can build on)
- **Engines**: browser-use (MIT), Stagehand (MIT — best primitives + caching), Agent-E (DOM distillation), Eko, LaVague. Avoid AGPL (Skyvern, Automa) for closed-source commercial.
- **Infra**: Steel.dev (Apache-2.0).
- **Vision/parsing**: OmniParser, Tarsier, WebMarker (Set-of-Marks), UI-TARS (open GUI model).
- **Extension template**: **Nanobrowser** (Apache-2.0) — closest open template to a universal agentic extension.
- **Discovery list**: github.com/steel-dev/awesome-web-agents.
- **Benchmarks**: WebVoyager, WebArena/VisualWebArena, OSWorld, Mind2Web, BrowserGym, ClawBench (153 live tasks, 2026).

## Where the competitive bar is NOW

**Table stakes (floor — defined by browser-use + Stagehand + Nanobrowser):**
- Hybrid perception (filtered a11y tree + DOM primary, Set-of-Marks screenshots fallback)
- CDP-native execution (stable element refs, speed)
- Planner → Executor → Validator with action history (avoid loops)
- BYO-key, local-first, multi-model
- Self-healing / change-observation recovery
- Human-in-the-loop before sensitive actions

**Differentiators that win:**
- Action caching / record-once-replay-free (Stagehand-style) — cuts cost & latency
- Parallel multi-tab / shadow-browser research (Fellou/Manus)
- Persistent agentic memory of past sessions + learned site flows (Atlas memories, Fellou, Sider Wisebase)
- Safe, local operation on logged-in/authenticated sites (huge value, big risk)

**Still unsolved (the open frontier):**
1. Reliability on complex real flows (JS checkout, multi-step sessions, dynamic SPAs)
2. CAPTCHA / bot-detection (no clean ToS-compliant answer)
3. Cost & latency of vision loops at scale
4. Trust, permissions, auditability for agents with credential access
5. Long-horizon planning + recovery from a wrong action 15 steps deep
6. Standardized, portable memory & skills format

## Bottom line for Chrome_Buddy
Be competitive by shipping a **CDP-native hybrid (DOM-first + vision-fallback) planner/executor/validator loop, BYO-key multi-model, local-first, with action caching, self-healing recovery, and explicit human-in-the-loop consent** — now essentially the floor. Stand out on **reliability for authenticated/complex flows, parallel research, and persistent cross-session memory** — exactly where even Atlas/Comet and the abandoned Mariner fall short. The open-source spine (browser-use or Stagehand engine, Steel infra, OmniParser/WebMarker vision, Nanobrowser as extension template) means build effort can concentrate on the reliability + memory + safety moat.
