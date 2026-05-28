# Security Policy

Chrome Buddy is a credential-handling browser extension. The threat model is
deliberately narrow, the trust boundaries are explicit, and we expect both
adopters and contributors to understand them before relying on the extension
for anything consequential.

## Reporting a vulnerability

**Please do not file a public issue for a security vulnerability.** Email
**clemens@focuspulleratwork.com** with:

- The vulnerable surface (file path / feature)
- A reproducible test case (steps, or a minimal patch)
- The impact you observed (data leak, code execution, gate bypass, …)
- Whether the issue is exploitable as-shipped or only with a specific
  configuration

Expect an acknowledgment within **3 business days** and a status update
within **10 business days**. Disclosure timeline depends on severity but
will not exceed 90 days from the initial report.

## Threat model

We protect against:

1. **Page-side prompt injection** — anything on a web page is treated as
   untrusted data. Page content the model sees is fenced in the system
   prompt; MCP tool descriptions are sanitized + truncated before joining
   the planner prompt.
2. **Accidental disclosure of API keys** — keys live only in
   `chrome.storage.session` (in-memory, cleared on browser restart). They
   never enter rendered UI, IndexedDB, the shipped bundle, or any chat
   message. The dev-only `VITE_GEMINI_API_KEY` env fallback is inlined at
   build time and is documented as a contributor footgun.
3. **Consequential actions without consent** — every consequential tool
   (`send_webhook`, `github_write`, `write_file`, every MCP call by
   default) gates through the HITL confirm card before any external side
   effect. The card shows the exact arguments. The user clicks Approve or
   Cancel. There is no path to a consequential action without that
   approval.
4. **Remote code execution** — the extension is **MV3-strict**: zero
   remote code in the runtime. Tier-1 apps are pure data (a form + a
   prompt template). Tier-2 apps run user-authored JavaScript in an
   **opaque-origin sandboxed iframe** with a permission-aware capability
   bridge (no DOM access, no `fetch`, no `chrome.*` APIs unless the user
   has reviewed + granted the capability).
5. **Tab driveability mistakes** — restricted URLs (`chrome://`, Chrome
   Web Store, `view-source:`, `chrome-extension://`, `file:`,
   `javascript:`) are refused at the page-tool layer with a structured
   `undriveable` error rather than silently failing.

We do **not** protect against:

- **A malicious browser profile.** If an attacker has read access to the
  victim's Chrome profile, they can read IndexedDB (webhook URLs, server
  registry, library docs) and persisted preferences. Chrome's profile
  security is the floor.
- **A compromised MCP server.** Connecting an MCP server means trusting
  its tool descriptions and the data it returns. We sanitize descriptions
  + require per-tool trust, but if the user enables a server and trusts
  its tools, the server is in the trusted compute base.
- **A misbehaving Gemini model.** If the model proposes a malicious tool
  call (e.g. `github_write` to a sensitive path), the **HITL gate is the
  final defense** — the user must approve every consequential call.

## Key custody (NFR-SEC-1)

| Surface | Storage |
|---|---|
| Gemini API key | `chrome.storage.session` (background SW only) |
| GitHub PAT | `chrome.storage.session` (background SW only) |
| MCP bearer tokens | `chrome.storage.session`, keyed by server id |
| Webhook URLs | IndexedDB (the URL may contain a secret in the path) |
| Default repo (`githubDefaultRepo`) | `chrome.storage.local` |
| User profile (name / role / about) | `chrome.storage.local` |

**`chrome.storage.session` is in-memory only.** It does not persist across
browser restarts. After a restart you re-paste your keys. This is intentional
— the trade-off is annoyance for users vs. a permanent disk footprint of
credentials. We have **no plans** to relax this for the default path.

### What about webhook URLs?

Webhook URLs are stored in IndexedDB because they are *destination*
addresses, not authentication credentials in the traditional sense — but
many SaaS webhooks (Slack, Zapier, Discord) embed a per-channel secret in
the URL path. The UI masks them on screen; IndexedDB itself is not
encrypted. If a stolen browser profile is a threat for you, do not save
webhook URLs in the address book.

## HITL gate — the last line of defense

The consequential-action gate is the most security-critical surface in
the entire extension. The contract:

1. The agent runtime sees the model's proposed tool call.
2. It checks `consequential: boolean` on the tool definition.
3. If consequential and not already approved → emits a
   `confirmation_required` event, pauses the run, awaits the resolver.
4. The panel renders the **`.hitl`** confirm card with the exact tool
   name + arguments + summary + Approve / Cancel buttons.
5. The user's click resolves the promise the runtime is awaiting.
6. The tool only fires if Approve was clicked.

Regressions in the rendering of the confirm card (button clipped behind a
banner, body not visible, args truncated invisibly) are treated as
**HIGH-severity bugs** and locked by e2e regression tests:

- `tests/e2e/pending-confirm-banner.spec.ts`
- `tests/e2e/confirm-card-live-race.spec.ts`
- `tests/e2e/github-confirm-card-repro.spec.ts`

If you find a way to land a consequential action without that gate
firing, **report it as a vulnerability** via the email address above.

## Known limitations

We are honest about gaps so you can make an informed call:

1. **Webhook URLs in IDB are plaintext.** See the table above.
2. **`chrome.storage.local` is readable by anyone with disk access.**
   Default repo + profile fields live there because they aren't secrets
   per se — but a determined attacker with your profile can read them.
3. **Tier-2 sandboxed code is constrained by the iframe sandbox**, not by
   formal analysis. A complex enough capability surface could in principle
   reach data it shouldn't via timing or shared-buffer side channels. We
   keep the bridge intentionally small.
4. **MCP servers are trusted compute.** No sandbox between you and a
   server you enabled. Use per-tool include + trust toggles to keep the
   surface minimal.
5. **Some test surfaces are not yet covered.** See
   [`docs/night-test-audit.md`](docs/night-test-audit.md) for the
   honest list. We mark known gaps as such rather than weakening tests
   to hide them.
6. **The dev-only `VITE_GEMINI_API_KEY` env path inlines the key into
   `dist/`.** Never zip up `dist/` for distribution after a build that
   read that env. The shipped path is the in-app onboarding screen.

## In scope for reports

- The extension source code (`src/`, `public/`, `manifest.json`)
- Default model adapters (`src/llm/adapters/`)
- Built-in tools (`src/background/*`)
- The HITL gate and approval resolver
- The Tier-2 sandbox host (`src/sandbox/`)
- MCP transport + dispatcher (`src/mcp/`, `src/background/mcp.ts`)
- The MV3 manifest and any browser-API misuse

## Out of scope for reports (we will redirect or close)

- Vulnerabilities in `@google/genai` itself → upstream
- Vulnerabilities in third-party MCP servers you connect to → that server
- Vulnerabilities in Chrome itself → Google's VRP
- Issues only reproducible with a custom Tier-2 code app you wrote
  (the sandbox boundary is the contract; what your code does inside is
  your responsibility)
- Social-engineering scenarios that rely on the user explicitly
  approving a malicious-looking confirm card

## Acknowledgments

We will credit reporters in release notes unless asked not to.
