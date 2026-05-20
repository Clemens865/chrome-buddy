# Extensibility & Future-Proofing

> Two capabilities: (A) add/generate new micro-apps in-app, (B) adopt new models/API routes without re-shipping. Both hinge on MV3's bright line: **data is allowed; remotely-hosted/eval'd code is banned.**

## The bright line (Chrome Web Store policy, verbatim)
Remotely hosted code = "anything executed by the browser loaded from someplace other than the extension's own files. Things like JavaScript and WASM… **does not include data or things like JSON or CSS.**"

**Banned:** remote `<script>`, `eval()` of fetched strings, and — critically — "**building an interpreter to run complex commands fetched from a remote source, even if those commands are fetched as data.**"

**Explicitly allowed:** "Fetching a remote configuration file… for determining enabled features, where **all logic for the functionality is contained within the extension package**"; syncing user data; fetching non-logic resources (images).

→ Config/data may be fetched, edited, generated, imported freely. Logic must ship in the package. Config must be *declarative* (URLs, IDs, booleans, enums, param names) — never expression strings/templates our code then evaluates.

---

## A. Self-extending micro-app system (import + AI-generate apps)

**Two-tier design: "fixed interpreter over data, with a gated code escape hatch."**

### Tier 1 — Declarative apps (default, ~90%) ✅
- **Format**: JSON config — `{ inputsSchema, promptTemplate, pipeline[], allowedTools[], outputRenderer, requiredHosts[] }`. Pure data → never RHC, even when imported/fetched.
- **Runtime**: our bundled `GenericApp` interpreter, extended over time with more *shipped* primitives (JSONLogic/JMESPath expressions, multi-step pipeline runner, bundled renderers: table/chart/markdown/diff). Configs stay data.
- **AI generation**: Gemini with **structured/JSON output constrained to our schema** → validate against allowlists (keys, node types, renderers, tools, hosts) → persist to storage/IndexedDB.
- **Sharing**: export/import portable JSON bundles + a server-hosted **catalog of configs** (fetching data is fine). Semver + `schemaVersion` + migrations. Consent screen on import showing tools/hosts requested.
- This is exactly where MicroLabs' config-driven `GenericApp` already sits — **AI-generating new JSON configs adds capability at ~zero compliance risk.**

### Tier 2 — Code apps (rare, gated escape hatch) ⚠️
- **Runtime**: a **sandboxed iframe** (manifest `sandbox` key, opaque origin, `allow-scripts` WITHOUT `allow-same-origin`) hosting **QuickJS-wasm** (or SES `Compartment` after `lockdown()`). Generated/imported code runs with **zero ambient authority**.
- **Capability bridge**: a narrow `postMessage` RPC. Sandbox can only call operations we expose (`gemini.generate`, gated `fetch` against host_permissions, app-scoped storage). Host authorizes each call against the app's declared permissions.
- **Trigger**: only when a request exceeds the declarative vocabulary. Always with **human review** of generated code + capabilities before first run.
- **DOM-acting apps** (must manipulate current tab): use `chrome.userScripts` with `configureWorld({messaging:true, csp})` — accepts the per-extension "Allow User Scripts" toggle + heightened review. Reserve for apps that truly need it.

### Hard compliance rules
1. **Never fetch executable JS/WASM and run it.** Configs fetched freely; code generated on-device or user-supplied only.
2. **Bundle the interpreter + `.wasm`** (CSP `wasm-unsafe-eval` for QuickJS); ship readable, non-obfuscated engine code.
3. Generated/imported code runs **only** in the sandboxed iframe/VM/userScripts world — never `eval` in a privileged context.
4. **Capability model, not blocklists**: every runtime starts with nothing; inject specific gated functions; enforce timeouts/termination.
5. **Frame single purpose as the platform** ("AI workspace for building/running micro-tools") so generated apps stay on-theme for review.
6. **Validate against allowlists** before persisting anything AI-generated or imported.

### Comparable models (lessons)
- **GPT Store / Bardeen playbooks** — config-only tier, no review needed, freely shareable.
- **Raycast / VS Code** — code tier via central review + trust signals (we can't grant host trust → isolate instead).
- **MetaMask Snaps** — untrusted JS in SES with capability-gated permissions = the architecture to copy for our code tier.
- **Tampermonkey** — userScripts viability under MV3.

---

## B. In-app + remotely-updatable model/API registry ✅

A model registry is **inert data driving bundled logic** — identical in nature to storing settings/keys. Adopt new Gemini models (and whole providers) with zero code changes.

### Registry schema (stored in `chrome.storage.local`; keys stored separately)
```jsonc
{
  "schemaVersion": "1.0",
  "providers": {
    "google-gemini": {
      "id": "google-gemini", "displayName": "Google Gemini",
      "adapter": "openai-compatible",                              // names a BUNDLED module
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
      "auth": { "method": "bearer", "keyRef": "secret:gemini" }
    }
  },
  "models": {
    "gemini-3.5-flash": {
      "id": "gemini-3.5-flash", "provider": "google-gemini",
      "displayName": "Gemini 3.5 Flash",
      "contextWindow": 1048576, "maxOutputTokens": 65536,
      "pricing": { "inputPerMTok": 1.5, "outputPerMTok": 9.0 },
      "capabilities": { "vision": true, "tools": true, "thinking": true, "jsonMode": true, "streaming": true },
      "defaultParams": { "temperature": 0.7 },
      "paramMap": {}, "enabled": true
    }
  }
}
```
**Adding a new Gemini model = one config entry, zero code** — the bundled `openai-compatible` adapter just forwards the model string to `${baseUrl}/chat/completions`. (Gemini ships an OpenAI-compatible endpoint at `…/v1beta/openai/`, so Gemini, OpenAI, OpenRouter, Groq, Ollama, etc. all run through one adapter.)

### Remote config auto-update ✅ (data, not code)
```
fetch(remoteUrl) → verify signature (Ed25519/JWS, optional but recommended)
  → validate against bundled JSON Schema (Ajv) → check schemaVersion compat
  → merge into local registry (precedence: user-edit > remote > bundled-default)
  → persist to chrome.storage (cache for offline)
```
- Trigger on SW start + `chrome.alarms` daily poll; **never block first use** — bundled-default registry is the floor.
- Sign config server-side, embed public key, verify with `crypto.subtle` before merge (prevents a compromised CDN injecting a malicious `baseUrl` that steals the key).
- Never let remote config carry code-like payloads (JS, expression strings, request templates we evaluate) — that flips allowed "data" into the banned "interpreter for fetched commands."

### Provider abstraction (registry-driven adapter)
Bundle 2–3 adapters: `OpenAICompatibleAdapter` (covers Gemini-OpenAI, OpenAI, OpenRouter, Groq, Together, Ollama, LM Studio, vLLM), optional `AnthropicMessagesAdapter`, `GeminiNativeAdapter` (for native features the OpenAI shim drops: thinking budgets, native multimodal). Minimal interface: `buildRequest`, `parseResponse`, `parseStreamChunk`, `mapToolsToWire`, `parseToolCalls`. Registry `adapter` field selects which; `paramMap` handles renames declaratively.

### Graceful capability handling
- **Declared** (preferred): `capabilities` block gates UI (hide image upload if `!vision`, omit tools if `!tools`).
- **Probe + defensive fallback** for unknowns: default conservative (text-only, no tools); on a 400/"unsupported param" error, set the cap false in cache, retry without it, notify once; parse responses defensively (never assume `choices[0].message.tool_calls` exists); persist probe results per `provider+model`.

### Web Store verdicts
- Update model list / IDs / params / pricing via remote JSON → ✅ clearly allowed.
- Update endpoints (base URLs) via JSON → ✅ allowed as data.
- Add a whole **new provider** (new host + auth) via config → ⚠️ allowed as data, but the real limit is **network permissions**: use `optional_host_permissions` + `chrome.permissions.request()` when a user adds/enables a provider host. Pre-declare hosts for default providers. Genuinely new wire protocols are the only thing needing a shipped code update (a new bundled adapter — after which its models are config-only again).

---

## Net effect
- **New micro-app**: AI generates a validated JSON config (Tier 1) → no resubmission; rare code apps run in a bundled sandbox/userScripts world (Tier 2).
- **New Gemini model**: one-line registry add, locally or pushed via signed remote config → no code, no resubmission.
- **New provider**: config entry + runtime host-permission grant.
- **New wire protocol**: the only case needing a shipped update (one new bundled adapter).
