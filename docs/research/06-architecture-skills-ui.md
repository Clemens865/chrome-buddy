# Architecture — Skills, Agent Loop, Workflows & UI

> How to combine a micro-app suite + agentic chat + user-extensible skills + workflows in one MV3 extension.

## 1. Skills / agents system (data, not code)

A **skill = validated JSON**, never executable code (MV3 compliance + Web Store review + security).

```jsonc
{
  "id": "competitor-price-watch",
  "name": "Competitor Price Watch",
  "description": "Always in context — used by the agent to decide relevance",  // short
  "trigger": { "type": "manual | schedule | event", "value": "..." },
  "systemPrompt": "Detailed instructions, loaded on demand",
  "allowedTools": ["navigate", "read_dom", "screenshot", "send_webhook"],  // whitelist into central registry
  "inputs": [{ "name": "url", "type": "string", "required": true }],
  "outputSchema": { /* Gemini responseSchema for structured output */ },
  "steps": [ /* optional pre-defined workflow steps */ ]
}
```

- **Description always in context; body loads on demand.** `allowedTools` whitelist is the compliance + security boundary.
- The agent discovers/invokes skills via a single meta-tool **`call_skill`** (Gemini function calling).
- **Import/export** as self-contained JSON, re-validated against the local registry on import.
- Code-skills (advanced) only via `chrome.userScripts` / sandboxed iframe — never remote eval.
- Pattern references: Claude Code skills, OpenAI GPTs/Actions, Bardeen playbooks, HARPA commands, n8n nodes.

## 2. Multi-step agentic loop (plan → act → observe → reflect)

Built on **Gemini function calling**, with **`gemini-2.5-computer-use` as a fallback tier** (prefer DOM tools over screenshots/coords).

**Tool set the agent draws from (same registry the apps use):**
`navigate`, `click`, `type`, `scroll`, `read_dom`, `screenshot`, `summarize`, `extract`, `call_skill`, `send_webhook`, `read_file`, `write_file`, `ask_user`.

- **Loop**: plan → call tool(s) → observe result/page change → reflect → repeat until goal or budget hit.
- **HITL**: a `consequential` flag on tools (send/buy/delete/auth) + Computer Use's `safety_decision: require_confirmation` → render an **inline confirmation card**; resend with `safety_acknowledgement: true` on approval.
- **Memory**: structured scratchpad between steps (IndexedDB), action history fed back to avoid loops.
- **Recovery**: bounded retries, alternative-element fallback, change-observation, escalation ladder, circuit breakers.
- Gemini supports **parallel + sequential** tool calls keyed by call `id`, and `responseSchema` for structured outputs.

## 3. Workflow builder

Skip full node-graph canvas for v1 (wrong fit for a narrow panel). Ship three front doors producing **one shared step schema** (HARPA-style vocab: `navigate / extract / gpt / branch / loop / jump`, with `{{param}}` variables):
1. **NL → workflow** (Bardeen Magic Box style) — describe it, agent drafts steps.
2. **Linear step-list editor** — edit/reorder steps.
3. **Recorder** — record clicks/inputs → generate steps.

Skills and workflows share the same schema — a skill is a saved, parameterized workflow/app-action.

## 4. UI shell — always-on expandable sidebar + icon rail

VS Code / Slack / Sider pattern: **always-visible vertical icon rail + expandable content panel.**

```
┌─┬──────────────────────────────┐
│💬│  Chat with Buddy        ⚙ ⤢ │   ← icon rail (left) + content panel
│  │ ─────────────────────────── │
│▦ │  ┌────────────────────────┐ │   💬 Agent chat (home)
│  │  │ Agent: researching...  │ │   ▦ Apps grid
│✦ │  │ • opened 3 tabs        │ │   ✦ Skills
│  │  │ • [Confirm: send email]│ │   ⤳ Workflows
│⟲ │  │ ▸ screenshot analyzed  │ │   ⟲ History
│  │  └────────────────────────┘ │
│  │  > type a task…         🎙 │   🎙 voice (STT)
│⚙ │ ─────────────────────────── │   ⚙ Settings (pinned bottom)
└─┴──────────────────────────────┘
```

Collapsed rail (always-on, minimal width):
```
┌─┐
│💬│
│▦│
│✦│
│⟲│
│⚙│
└─┘
```

- **Chat is home.** Apps grid launches micro-apps in the same panel. Skills/Workflows/History are management views. Settings pinned bottom.
- **"Always-on"** = global `sidePanel` + `openPanelOnActionClick` + a keyboard command. The API **can't auto-open without a gesture**, so design around pinning, not auto-launch.
- Content-script overlay for in-page anchored UI; offscreen doc for invisible/audio work.

## 5. App-suite + agent coexistence (the key payoff)

**One tool registry both the apps and the agent draw from**, behind shared services:

```
        ┌───────────────── Shared Services ─────────────────┐
        │ PageContext │ Gemini client │ Skill/Workflow Store │
        │ Memory (IndexedDB) │ Tool Registry (single source) │
        └────────────────────────────────────────────────────┘
            ▲                    ▲                    ▲
    ┌───────┴───────┐   ┌────────┴────────┐   ┌──────┴───────┐
    │  Micro-apps   │   │   Agent loop    │   │ Skills/Workflows│
    │ (1 capability,│   │ (LLM caller of  │   │ (saved compos- │
    │ tailored UI)  │   │ same capabilities)│  │ itions)        │
    └───────────────┘   └─────────────────┘   └────────────────┘
```

1. **PageContext** is the only place that reads/parses pages — apps and agent both consume it.
2. **Gemini client** is the single LLM client (model selection, keys, retries, streaming, structured output, Computer Use).
3. **Skill/Workflow Store** owns persistence + schema validation + import/export — the "data not code" boundary.
4. **Memory** shared so an app's output can seed an agent run.
5. **Agent loop** is a *consumer*, not a peer — it orchestrates registry + context + Gemini + memory; holds no capability of its own.

**Escalation path (one mental model — *capabilities* at three automation levels):**
- Micro-app = one capability, deterministic, tailored UI, no LLM planning.
- Every app exposes **"hand to Agent"** → packages its context and seeds a multi-step run ("now do this on the next 10 pages and email me").
- Agent can invoke any app's capability as a tool, and can deep-link the user into an app view to finish manually (HITL).
- A **skill** is the saved, parameterized form of an app action or agent sequence; **skill + trigger = workflow**.

## Key platform facts to design around
- `chrome.sidePanel` persists across tabs but **can't be force-opened** — needs a gesture; "always-on" via pinning + keyboard command.
- MV3 bans remote/eval'd code but **allows** fetching/caching remote JSON, `executeScript({func,args})`, WASM, sandboxed iframes — the skill/workflow system rides this "data, not code" allowance.
- Gemini Computer Use: normalized 0–999 coords, `safety_decision: require_confirmation` → resend with `safety_acknowledgement: true`. Loop = screenshot-in → functionCall-out → execute → screenshot-back.
- Gemini function calling: parallel + compositional/sequential calls keyed by `id`; `responseSchema` for structured outputs.
