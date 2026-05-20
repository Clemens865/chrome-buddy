# Chrome_Buddy — User Journeys

> 5 make-or-break end-to-end scenarios spanning all three layers (micro-apps, agentic chat, skills/workflows) plus self-extension and the model registry. Grounded in `vision-scope.md`, LOCKED `scope-decisions.md`, and research docs `02`, `05`, `06`.
>
> Primary user throughout: **the browser-resident knowledge worker / power user** (researcher, analyst, sales/ops, technically-comfortable generalist) — BYO Gemini key, lives across many tabs, churns between AI extensions, demands transparency and control.

---

## Scenario 1: Agentic Multi-Step Task — Competitor Pricing Comparison

### Trigger — what starts it, user's state
A product marketer is preparing a positioning deck. Her manager asks for a pricing comparison of three named competitors by end of day. She has the three company names, no URLs gathered yet, and a Google Doc open she wants the result in. She is in "I'd rather not spend 40 minutes tab-juggling" mode. She pins the Chrome_Buddy side panel (already on a key chord) and types into chat.

### Current State (Before) — how they do it today, pain points marked
1. Google each competitor, click through to find the real pricing page (not blog/press). — *pain: 3× manual search + disambiguation*
2. Open each pricing page in its own tab, scroll, mentally parse tiers/prices/limits. — *pain: dense, inconsistent layouts; easy to misread*
3. Copy numbers into a scratch doc or paste page text into a separate ChatGPT/Sider tab for help. — *pain: copy-paste loop, context lost between the chat tab and the doc (`02`: knowledge tools siloed from action)*
4. Hand-build a comparison table in the Doc, reconcile mismatched tier names. — *pain: tedious, error-prone reconciliation*
5. Re-verify a number she's unsure about by going back to the tab. — *pain: no provenance trail; was that price current?*

Status quo with the "capable" agents (Operator/Comet/HARPA, per `05`): they *can* do this but route through opaque cloud, hide the model + cost, and ~1-in-4 complex flows fail silently — and she can't watch or trust the write-into-her-doc step.

### Desired State (With Chrome_Buddy) — numbered steps
She types: *"Research Acme, Bolt, and Cyrus. Find each one's pricing page, capture the plans and prices, and put a comparison table in my open Google Doc."*

1. **Plan preview.** Agent (Planner) drafts a visible step plan: search → identify pricing URL ×3 → read_dom each → extract structured tiers → assemble table → *confirm before writing to Doc*. — *data needed: 3 company names (given), active-tab inventory. User decision: approve/edit plan or just let it run. What could go wrong: wrong company (e.g. a different "Bolt"). What she sees+feels: a clear numbered plan in the chat thread, model badge `gemini-3.5-flash` and a running $ cost — "I can see exactly what it intends to do."*
2. **Resolve each competitor.** Agent uses `navigate`/search + `read_dom` to find the canonical pricing page, DOM-first (no screenshots yet). For an ambiguous match it emits `ask_user`: *"Two companies named Bolt — fintech or logistics?"* — *data needed: search results, DOM links. User decision: disambiguate. What could go wrong: picks marketing page not pricing. What she sees: live step log "opened acme.com/pricing ✓".*
3. **Extract structured pricing.** `read_dom` + `extract` with a `responseSchema` (plan name, price, billing period, key limits). For a JS/canvas pricing widget where DOM extraction returns nothing, agent **escalates to the vision fallback tier** (`gemini-2.5-computer-use-preview`) — takes a screenshot, runs vision analysis. — *data needed: page DOM / screenshot. What could go wrong: pricing behind a "Contact sales" wall → agent records "enterprise: quote-only" rather than inventing a number. What she sees: a per-competitor mini-result card; a small "vision used here" marker on the one that needed it (transparency).*
4. **Assemble + reconcile.** Agent normalizes mismatched tier names into one table in its scratchpad (IndexedDB), keeping source URLs as provenance. — *user decision: none yet. What she sees: a draft comparison table rendered inline in the panel before anything is written externally.*
5. **HITL confirmation before the consequential write.** Writing into her Google Doc is flagged `consequential`. Agent renders an **inline confirmation card**: the exact table + "Insert into [Doc title] at cursor?" with Approve / Edit / Cancel. — *data needed: target Doc, insert location. User decision: the make-or-break approval. What could go wrong: wrong doc / wrong place → she edits target first. What she feels: in control — "nothing touched my doc until I said so" (anti-goal #7, success metric #2).*
6. **Execute + summarize.** On approve, agent inserts the table, posts a short summary with per-cell source links and total cost ($0.04, 47s). — *what she sees: done card with provenance + cost; option "Save as skill" (→ Scenario 4).*

### The Magic Moment
Step 5→6: she clicks **Approve** on a fully-built, source-linked comparison table and it lands in her doc — work she'd have spent 40 minutes on, done in under a minute, with every number traceable and **nothing consequential having happened without her one deliberate click.**

### Competitive Advantage
- vs Operator/Comet/HARPA (`02`/`05`): **model-transparent + BYO-key + visible cost**, where they hide all three ("Models: Undisclosed").
- vs all capable agents: **DOM-first** (fast/cheap/private) with vision only as a marked fallback — directly the pivot `05` documents (Mariner killed for vision-first).
- vs the ~1-in-4 silent-failure rate (`05`): the **plan preview + confirmation gate + `ask_user`** turn silent failure into a visible decision point.
- vs the copy-paste-into-a-chat-tab status quo (`02` friction #4): the agent *acts in place* and keeps provenance — no siloing between "knowledge" and "doing".

### Edge Cases
- **Wrong/ambiguous company:** `ask_user` disambiguation rather than guessing.
- **Pricing page is JS/canvas:** DOM extraction empty → escalate to vision fallback tier; mark it.
- **"Contact sales" / no public price:** record "quote-only", don't fabricate.
- **CAPTCHA / login wall on a competitor site:** per anti-goal #4 — detect, pause, hand control to the human ("solve this and click Resume").
- **Gemini API slow / rate-limited:** tiered fallback (Flash → Flash-Lite), show "model busy, retrying" rather than hang; budget/step cap prevents runaway.
- **Doc not open at confirm time:** confirmation card surfaces "target doc not found — pick one" instead of writing blindly.
- **One competitor fully fails:** deliver the 2 that worked + a flagged "couldn't get Cyrus pricing — login wall" row, not an all-or-nothing abort.

---

## Scenario 2: Quick Micro-App Use — One-Shot "Extract Table"

### Trigger — what starts it, user's state
A financial analyst is on a dense HTML page with a fund-holdings table he needs in a spreadsheet *now*. He doesn't want a conversation or a multi-step agent — he wants one deterministic action. He opens the side panel, clicks the **Apps** rail icon, and the apps grid appears.

### Current State (Before) — how they do it today, pain points marked
1. Try to select the table and copy — gets ragged, merged, or loses column structure. — *pain: HTML tables rarely copy clean*
2. Fall back to a paid scraper extension or paste the whole page into a chat tab and prompt "extract this as CSV". — *pain: yet another single-purpose tool / a chat-tab detour, model + cost unknown (`02`)*
3. Hand-fix the CSV, paste into Sheets. — *pain: re-formatting toil*

### Desired State (With Chrome_Buddy) — numbered steps
1. **Pick the app.** In the apps grid he taps **Extract Table** (a Tier-1 micro-app — one capability, deterministic, tailored UI, no agent planning, per `06` §5). — *data needed: nothing yet. User decision: which app. What he sees: a small grid of focused tools, search box on top.*
2. **Scope the target.** App reads the page via the shared **PageContext** service (the *only* page reader, shared with the agent — `06` §5.1). If multiple tables exist, app shows thumbnails/labels: "3 tables found — which?" — *data needed: parsed DOM tables. User decision: pick the right table (or "all"). What could go wrong: the data is a CSS grid, not a `<table>` → app says "no semantic table here — try Agent for layout extraction" (graceful handoff).*
3. **Choose output.** Toggle: CSV / Markdown / JSON; "first row is header" checkbox pre-detected. — *user decision: format. What he sees: a live preview of the parsed grid right in the panel before committing.*
4. **Run + deliver.** One click → structured output rendered + **Copy** and **Save to file** (File System Access API root folder, per scope decision #4). Model badge shows "deterministic — no LLM call, $0.00" (transparency even when free). — *what he feels: instant, clean, free, no chat detour.*
5. **Optional escalate.** A persistent **"Hand to Agent"** button on the app: *"now do this on the next 10 fund pages and compile one sheet"* — packages this app's context and seeds a multi-step run (the escalation path, `06` §5). — *the same capability, consumed at a higher automation level.*

### The Magic Moment
Step 4: the messy on-screen table appears as clean, perfectly-columned CSV in the panel **with one click and zero prompting** — the "I didn't have to explain anything, it just did the obvious thing" feeling that one-shot micro-apps own.

### Competitive Advantage
- vs multi-model assistants (Sider/Merlin, `02`): no chat round-trip for a deterministic task — a *tailored UI for the job*, not a generic prompt box.
- vs single-purpose scraper extensions: it's one tool in a shared suite, and it **upgrades into agentic breadth** via "Hand to Agent" (no other suite offers the same capability at app *and* agent *and* skill levels — the locked "one registry, three levels" payoff).
- Transparency even on free deterministic ops ("$0.00, no LLM") reinforces the model-cost-honesty differentiator (`02` gap #2).

### Edge Cases
- **No semantic `<table>` (CSS-grid layout):** detect and offer the Agent/vision path instead of returning garbage.
- **Huge table (10k rows):** stream/paginate the preview; warn before a giant copy.
- **Merged/nested cells:** flatten with a visible "merged cells expanded" note.
- **Page still loading / lazy-rendered rows:** PageContext waits-for-stable, or app prompts "scroll to load all rows, then re-run".
- **No folder picked yet for Save:** first save triggers the one-time File System Access folder pick.

---

## Scenario 3: AI-Generate a New Micro-App In-App

### Trigger — what starts it, user's state
A recruiter repeatedly needs to pull "name, title, company, location" from candidate profile pages into a consistent format. No app in the grid does exactly that. She doesn't code. In the apps grid she clicks **"+ New app — describe it"**.

### Current State (Before) — how they do it today, pain points marked
1. Re-prompt a chat tab the same way every time, re-pasting page content. — *pain: repetitive prompt rebuilding, inconsistent output shape*
2. Or give up and copy fields by hand. — *pain: pure toil*
3. No tool lets a non-coder *mint a reusable button* for their own niche task. — *pain: extensibility is locked to vendors (`02`: verticals are owned, narrow)*

### Desired State (With Chrome_Buddy) — numbered steps
1. **Describe in NL.** She types: *"Pull the person's name, job title, company, and location from a profile page and give me one tidy line, plus a JSON option."* — *data needed: the description; current page as a live example. User decision: how to phrase it. What she sees: a generation panel with her words + a "use current page as test sample" toggle.*
2. **Gemini generates a Tier-1 JSON config (default path).** Per scope decision #5 + `06` §1, the system asks Gemini to emit a **declarative JSON micro-app config** (input schema, the prompt template, a `responseSchema` for structured output, output rendering) — *data, not code.* — *what could go wrong: model emits malformed/over-scoped config. What she sees: "drafting your app…" with the model badge.*
3. **Validate against the registry schema.** The Skill/Workflow Store re-validates the generated JSON against the local schema and the `allowedTools` whitelist (the "data not code" compliance boundary, `06` §1/§3, anti-goal #3). Invalid → auto-repair prompt loop, capped. — *what could go wrong: requests a tool not in the registry → rejected/stripped. What she feels: safe — "it can't generate something dangerous".*
4. **Tier-2 escalation only if needed.** If the task genuinely needs imperative logic a JSON template can't express (e.g. custom date math / regex transforms), the system escalates to a **Tier-2 sandboxed code app** (QuickJS-wasm / SES, postMessage capability bridge — scope decision #5). Generated code runs *only* in the sandbox; never fetched/eval'd remotely (anti-goal #3). — *what she sees: a note "this one needs a small sandboxed script — runs isolated".*
5. **Live test before save.** The draft app runs against the current profile page; she sees the actual extracted line + JSON. — *user decision: accept / refine the description / tweak fields. What could go wrong: grabbed the wrong "company" (a mentioned employer vs current) → she refines: "current company only".*
6. **Save to grid.** Named, iconned, it appears in her apps grid like any built-in — and is **exportable as self-contained JSON** to share with her team (re-validated on their import, `06` §1). — *what she feels: "I just built my own tool by talking."*

### The Magic Moment
Step 5→6: she watches a tool *she described in one sentence* correctly extract from a real page, then clicks Save and it's a permanent button in her grid — **self-extension with zero code, validated and compliant**, the platform bet (`07`) made tangible.

### Competitive Advantage
- No mainstream competitor (`02`) lets a non-coder mint a *validated, reusable, shareable* micro-app from NL — Bardeen builds automations, but not deterministic single-capability apps in a shared registry.
- **Compliance-by-design**: Tier-1 JSON default keeps generation as *data*; Tier-2 only when needed, always sandboxed — the precise Web Store bright line (`07`, success metric #7), where naive "generate code" approaches would get rejected.
- Export/import as JSON seeds a future skill catalog (secondary user: skill authors) — extensibility as a data edit, no resubmission.

### Edge Cases
- **Ambiguous description:** generator asks one clarifying question rather than guessing the schema.
- **Generated config fails validation repeatedly:** cap retries, fall back to "let's refine together" with the linear field editor; never ship invalid JSON.
- **Requests a non-whitelisted tool/permission:** stripped + flagged; app degrades to what's allowed.
- **Tier-2 sandbox script errors at runtime:** isolated failure, surfaced as "this app's script errored" — can't touch the page or other apps.
- **Page sample is atypical:** warn that the app was tuned on one example; encourage testing on a second page before relying on it.


---

## Scenario 4: Save a Repeatable Workflow / Skill — From an Agent Run to a Triggered Skill

### Trigger — what starts it, user's state
The product marketer from Scenario 1 realizes she'll redo that competitor-pricing comparison every month, and her teammate Bolt-watch is weekly. After the run completes, she sees the **"Save as skill"** option on the done card and clicks it. (Per `06` §3, a skill is a saved, parameterized form of an agent sequence; skill + trigger = workflow.)

### Current State (Before) — how they do it today, pain points marked
1. Re-type the whole prompt from memory each month, slightly differently each time. — *pain: no reuse, drifting instructions*
2. In status-quo tools, automation lives in a different product than the chat that did the work (`02`: knowledge vs automation siloed). — *pain: can't promote "the thing I just did" into "the thing that runs itself"*
3. Scheduling/monitoring is gated behind premium automation tools at $20–33/mo (HARPA/Bardeen/Zapier, `02`). — *pain: cost + a separate mental model*

### Desired State (With Chrome_Buddy) — numbered steps
1. **Promote the run to a skill.** The completed run's steps are captured into the shared **step schema** (`navigate / extract / gpt / branch …`, `06` §3). The system proposes a skill name + a short `description` (always-in-context, used by the agent to decide relevance, `06` §1). — *data needed: the just-finished run's step log. User decision: confirm/edit name + description. What she sees: a draft skill card.*
2. **Parameterize.** The system detects the variable bits (the 3 company names) and offers them as `inputs` (`{{competitors}}`). — *user decision: which parts are parameters vs fixed. What could go wrong: over-fits the constants (a specific Doc URL) → she marks the doc as a parameter too. What she sees: highlighted variables in the step list, a linear editor to reorder/remove steps (the linear step-list front door, `06` §3).*
3. **Lock the tool whitelist.** The skill records its `allowedTools` (`navigate, read_dom, extract, write_file/doc, ask_user`) — the compliance + security boundary (`06` §1). — *what she feels: "this skill can only do these specific things".*
4. **Add a trigger.** She sets `trigger: schedule` = "1st of each month, 9am" (or `manual`, or `event`). — *data needed: schedule. User decision: trigger type. What could go wrong: a scheduled run that wants to write to a doc while she's away → the consequential write still requires confirmation, so a scheduled run **pauses at the gate and notifies her** rather than auto-writing (anti-goal #7 holds even for automation).*
5. **Save + appears in Skills rail.** Validated by the Skill/Workflow Store, it shows in the **Skills** view; **Workflows** view lists it with its trigger. Exportable as self-contained JSON to share with the team (re-validated on import). — *what she sees: a reusable, named skill she can fire from chat ("run competitor pricing for X, Y, Z") via the `call_skill` meta-tool.*
6. **Memory compounds.** On re-runs, the agent reuses learned site flows (which URL was Acme's real pricing page, that Cyrus is quote-only) from cross-session memory (IndexedDB) — fewer steps, lower cost than the first run. — *what she feels: "it got faster because it remembers" (success metric #3, memory-assisted lift).*

### The Magic Moment
Step 5→6: the thing she just *did once* becomes a named button + a scheduled job in two clicks — and the *second* run is visibly faster and cheaper because the agent remembered the site flows. The leap from "I did this" to "this now runs itself, and it learns" — the siloed gap (`02` #4) closed.

### Competitive Advantage
- **Promote-from-run** beats re-authoring: no competitor turns "the agent run I just watched" directly into a parameterized, scheduled, shareable skill in the *same* surface.
- **Cross-session memory feeding the automation** is the explicit unfilled gap (`02` #4, `05` differentiator) — knowledge tools (Recall/Liminary) never feed automation tools; here they're one system.
- **Scheduling without the $33/mo gate** (`02` #5) and **confirmation-gate integrity preserved even on scheduled runs** — automation that stays trustworthy unattended.
- Skills as **declarative JSON** = Web-Store-compliant, importable/exportable — the data-not-code platform bet (`07`).

### Edge Cases
- **Site layout changed since recording:** self-healing / change-observation recovery (`05`); if a step's selector is gone, re-plan that step and flag it in the run report.
- **Scheduled run hits a login/2FA wall while user away:** pause, notify, resume on return — never bypass auth.
- **Over-parameterized or under-parameterized skill:** test-run prompt before first scheduled fire; surface "this input was never used".
- **Consequential step in an unattended run:** hard-pause at the gate + push notification; no silent send/write (metric #2, 0 unauthorized executions).
- **Skill imported from a teammate references a tool/model not present:** re-validation flags missing capability on import, offers to map or disable that step.

---

## Scenario 5: Adopt a New Gemini Model via the Registry

### Trigger — what starts it, user's state
Google ships `gemini-3.6-flash` (cheaper + smarter than the current default). A power user wants it *today*, without waiting for an extension update or a Web Store re-review. A second variant: a developer wants to add a non-Gemini OpenAI-compatible provider. Both open the **Settings** rail (pinned bottom, `06` §4) → **Models & Providers**.

### Current State (Before) — how they do it today, pain points marked
1. Wait for the vendor to add the model in a future release; meanwhile the extension is pinned to old models. — *pain: model churn outpaces release cycles*
2. Most competitors hide which model even runs (`02`: "Models: Undisclosed") — no choice, no transparency. — *pain: opacity, can't optimize cost/quality per task*
3. Switching providers means switching products entirely. — *pain: lock-in*

### Desired State (With Chrome_Buddy) — numbered steps
1. **Zero-code arrival (the common case).** Because the model/provider registry is **signed remote-updatable data** (scope decision #6, `07`), `gemini-3.6-flash` appears in the model dropdown automatically after a registry refresh — no extension update, no resubmission. Adapter logic stays bundled; only *data* changed. — *data needed: signed registry entry. User decision: none — it's just there. What the user sees: a new model in the picker with its pricing + a "new" badge.*
2. **In-app add (power user).** If they want it before the signed push, they open the registry editor and add a **one-line config entry** (model id, context window, $/token, capabilities flags: supports-vision / function-calling / computer-use). — *user decision: the field values from Google's docs. What could go wrong: typo'd model id → adapter test call fails fast with a clear error, entry marked invalid (not silently broken).*
3. **Set as default / per-task.** They make it the workhorse default, or assign per-task tiers (cheap = Flash-Lite, hard = Pro, browser automation = computer-use). Mid-task model switching is supported. — *what the user feels: full control over cost/quality, visible per-model pricing (success metric #4, transparency engagement).*
4. **Add a provider (developer variant).** They add an **OpenAI-compatible provider** entry (base URL, key field, model list) via the registry-driven adapter (scope decision #2). The bundled adapter speaks the protocol; the provider is pure config/data — never remote code (anti-goal #3). — *what could go wrong: provider returns a non-conformant schema → adapter surfaces "incompatible response" rather than corrupting a run.*
5. **Live verification.** A "Test" button runs a tiny prompt against the new model/provider and shows latency + cost, confirming the key + entry work before relying on it. — *what the user sees: green check + sample token cost; the model now flows into apps, agent, and skills alike (one Gemini client, `06` §5.2).*

### The Magic Moment
Step 1: a brand-new model **just appears** in the picker the day Google ships it — no update, no waiting, no resubmission — and a power user can hand-add one even sooner with a single config line. Future-proofing as a routine data edit, exactly the platform bet (`07`, anti-goal #3, success metric — Web Store pass).

### Competitive Advantage
- vs "Models: Undisclosed" incumbents (`02` #2): not just transparent — **user-controllable and instantly extensible**, the cheap free differentiator made structural.
- vs vendor release cycles: **signed remote-updatable registry decouples model adoption from app updates** — no other extension makes new-model adoption a zero-resubmission data push (`07`).
- vs lock-in: **OpenAI-compatible adapter** means the Gemini default isn't a cage; multi-provider is a config entry.

### Edge Cases
- **Bad/unsigned registry payload:** signature check rejects it; fall back to last-good registry (no broken model list).
- **Invalid model id / wrong capability flags:** Test-call fails fast, entry flagged invalid, default won't switch to a broken model.
- **New model lacks a capability a skill needs (e.g. no computer-use):** capability flags let the agent route automatically to a model that has it, or warn.
- **Provider key invalid / quota exceeded:** clear error at Test time; tiered fallback to a working model so live runs don't hard-fail.
- **Pricing field stale:** cost display marked "est. — verify with provider"; never blocks usage.

---

## "Day in the Life" Narrative — the browser knowledge worker

**Before:** Maya, a product marketer, starts her day with eleven tabs and four AI extensions — one to summarize, one to write, a scraper, and a chat tab she pastes context into. The competitor pricing pull her manager wants means 40 minutes of searching, opening pricing pages, squinting at inconsistent tiers, copying numbers into a doc, and hand-building a table she can't fully vouch for. Her monthly reports are the same dance every time; nothing she learned last month carries over. She'd try a "real" agent like Comet, but she can't see which model it runs, what it costs, or trust it to write into her doc unsupervised — and she's heard they fail on the messy pages anyway.

**After:** Maya pins Chrome_Buddy and types one sentence. She watches a clear plan, sees `gemini-3.5-flash` and a ticking $0.03, answers one disambiguation, and approves a source-linked comparison table that drops into her doc — under a minute, every number traceable, nothing touched until she clicked Approve. She clicks "Save as skill," adds a monthly trigger, and next month it runs faster because it *remembered* the sites. When she needs a clean table off a dense page, she uses the one-click Extract Table app; when she needs a niche tool that doesn't exist, she describes it and it appears in her grid. The day Google ships a cheaper model, it's just *there* in her picker. The patchwork is gone: one trustworthy, transparent, self-extending surface that does the work and learns from it.

---

## Critical Path — the ONE scenario that must work perfectly on day one

**Scenario 1 (Agentic Multi-Step Task with the HITL confirmation gate) is the day-one make-or-break.**

**Why:** It *is* the wedge (`vision-scope.md`): "the agent reliably completes a real multi-step task I'd otherwise do by hand, and I trust it because I can see and approve every consequential step." It exercises the whole spine — Planner→Executor→Validator loop, DOM-first perception with vision fallback, the shared tool registry, cross-session memory, model+cost transparency, and — non-negotiably — the confirmation gate (success metric #2: 100% of consequential actions gated, 0 unauthorized executions; one breach kills credibility). It also directly attacks the ~1-in-4 silent-failure rate that sank Operator and Mariner (`05`). Scenarios 2–5 are high value but *downstream* of proving this loop is trustworthy; if the agent can't do verified multi-step work, nothing else matters.

**Minimum viable version (day one):**
- A single linear multi-step task on the **current + a few related tabs** (not parallel shadow browsers) — e.g. "summarize these 3 open tabs and put the result in a doc."
- **DOM-first only** (`read_dom`/`navigate`/`extract`/`click`/`type`); vision fallback can be a v1.1 add — DOM distillation alone hit 73.1% WebVoyager (`05`), enough to prove the loop.
- **Visible plan preview + live step log + model badge + running cost** (transparency from first build, metric #4).
- **The confirmation gate is fully present and hard** — every send/write/delete renders an inline Approve/Edit/Cancel card; absolutely no consequential action without it. This is the one thing that cannot ship at 90%.
- **`ask_user`** for disambiguation, and **graceful partial completion** (deliver what worked, flag what didn't) rather than silent abort.
- BYO Gemini key in `chrome.storage.session`; cross-session memory can start as a simple scratchpad and deepen later.

Everything else (vision tier, Tier-2 code apps at scale, parallel research, scheduled unattended skills, full provider marketplace) layers on *after* this loop is demonstrably trustworthy and reliable.
