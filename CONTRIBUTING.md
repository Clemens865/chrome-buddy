# Contributing to Chrome Buddy

Thanks for considering a contribution. This document is the bar: how to run
the project, how tests are organized, what the commit and code style look
like, and what we expect from a merge-able PR.

> If you're reporting a security issue, **do not open a GitHub issue** — see
> [`SECURITY.md`](SECURITY.md) for the disclosure path.

## Getting set up

```bash
git clone https://github.com/Clemens865/Chrome_Buddy.git
cd Chrome_Buddy
npm install
npm run build      # produces dist/ — load this into Chrome
npm test           # unit suite
```

To load the unpacked extension:

1. `npm run build`
2. Open `chrome://extensions`, enable **Developer mode**
3. Click **Load unpacked**, pick the `dist/` folder
4. Click the toolbar icon to open the side panel
5. Paste a Gemini API key on the onboarding screen
   ([free key from AI Studio](https://aistudio.google.com/apikey))

The key stays in `chrome.storage.session` (in-memory only). See
[`SECURITY.md`](SECURITY.md) for the full custody story.

## Running tests

| Command | What it runs | Notes |
|---|---|---|
| `npm test` | 519 unit tests (Vitest) | Required to pass before any PR |
| `npm run typecheck` | `tsc --noEmit` | Required to pass before any PR |
| `npm run lint` | ESLint | Required to pass before any PR |
| `npm run build` | typecheck + vite build | Catches manifest / asset issues |
| `npx playwright test` | 134 e2e (Playwright) | Required to pass before any PR |
| `npx playwright test --headed` | Same, in a visible browser | Useful for debugging |

### Live e2e (optional, gated by env)

Some e2e tests hit real external services. They **skip cleanly** when the
required env var is missing. Set them up by copying `.env.example` to
`.env` and filling in what you need:

| Env var | What it unlocks |
|---|---|
| `VITE_GEMINI_API_KEY` | Live Gemini calls (chat, agent, image gen, voice mode, etc.) |
| `GITHUB_TEST_PAT` + `GITHUB_TEST_REPO` | Live GitHub write/read against your test repo |

**Never commit `.env`.** The git-ignore rule covers `.env*` except
`.env.example`, but be careful never to log or screenshot the file.

The non-`VITE_` vars (`GITHUB_TEST_PAT`, `GITHUB_TEST_REPO`) are read at
test runtime via a tiny `.env` loader in `playwright.config.ts`. They are
**never inlined into the extension bundle**, by design — Vite only picks
up `VITE_*` keys.

## Project layout (where things live)

See the README for the full tree. The most common places you'll edit:

- **`src/views/ChatView.tsx`** — the chat surface. Big file (~1700 lines).
  Composer, transcript items, HITL card, voice + vision flows.
- **`src/agent/runtime.ts`** — the plan → act → observe → reflect loop.
- **`src/background/`** — service-worker side: key custody, LLM dispatch,
  page tools, webhook + GitHub + MCP handlers.
- **`src/tools/defs.ts`** — central tool catalog (schema + descriptions).
- **`src/db.ts`** — the single IndexedDB schema. Bump `VERSION` + add a
  store in `upgrade()` when adding persistent state.
- **`tests/e2e/`** — Playwright specs. The `helpers/seed.ts` helper has
  reusable chat-seeding utilities.

## Code style

- **TypeScript** for everything new. `any` is a smell.
- **ES modules** (`import`/`export`), no CommonJS.
- **Destructure imports** where it improves readability.
- **`async`/`await`** over Promise chains.
- **`const`/`let`**, never `var`.
- **Files cap at ~500 lines** — if you're adding a 6th screen of code,
  consider extracting a module.
- **Comments matter.** Every non-obvious code path should explain
  *why*, not *what*. Look at `src/mcp/transport.ts` or
  `src/background/github.ts` for the level of comment density we like.
- **Match the surrounding code.** Don't introduce a new naming convention
  or import style just because you prefer it.

### Patterns we follow

- **Pure helpers go in their own files** with co-located `.test.ts`.
  See `src/artifacts/extract.ts`, `src/mcp/merger.ts`, `src/webhookFlows/snapshot.ts`.
- **Keep the chrome / IDB / network surface narrow.** UI code should not
  reach into `chrome.storage` or `fetch` directly — go through the
  background SW via `chrome.runtime.sendMessage`.
- **Tool definitions live in `src/tools/defs.ts`** and are referenced
  from `src/background/background.ts`'s `TOOL_HANDLERS` map.
- **HITL is the contract**: consequential tools have `consequential: true`
  in their definition. Never bypass the gate.

## Writing tests

We use Vitest for units and Playwright for e2e against the built
extension. **A test failure is fixed by changing the code, not by
weakening the test.** If your test reveals a real bug, fix the bug.

### Unit tests

- Co-locate as `foo.test.ts` next to `foo.ts`.
- Use Vitest's `describe` / `it` / `expect`.
- Mock chrome APIs explicitly — the project doesn't auto-stub them.

### E2E tests

- Live in `tests/e2e/*.spec.ts`.
- Use the `{ context, extensionId }` fixture from `tests/e2e/fixtures.ts`.
- The fixture pre-sets `onboardingDone: true` and `askBeforePlan: false`
  so feature specs aren't blocked by gates.
- For deterministic specs, seed IDB directly via
  `tests/e2e/helpers/seed.ts`. Don't drive the LLM if you can avoid it.
- Live tests must gracefully `test.skip()` when their env var is missing.
- Every consequential UI flow should produce at least one screenshot in
  `screenshots/`.

## Commit style

We use **Conventional Commits**:

```
type(scope): short imperative summary

Longer body explaining WHY this change exists. What user-visible
behavior does it change? What was the failure mode you discovered?
What did you fix and how did you verify it?

Validation lines if relevant (e.g. "511/511 unit tests pass").

Co-Authored-By: RuFlo <ruv@ruv.net>
```

Types we use: `feat`, `fix`, `test`, `docs`, `refactor`, `chore`.

Common scopes: `chat`, `agent`, `mcp`, `github`, `apps`, `skills`,
`workflows`, `library`, `composer`, `voice`, `brand`, `settings`.

Examples from the recent history:

- `fix(skills): new-skill default flipped from 'agent' to 'chat'`
- `test(github): default-repo fallback + 401/404/no-token error paths`
- `feat(mcp): Phase 2 — agent integration with routing gates`

End commit messages with the `Co-Authored-By: RuFlo <ruv@ruv.net>` trailer
if RuFlo was involved (this is the project's convention).

## Pull request bar

A PR is merge-ready when:

1. `npm test` passes (519/519 unit)
2. `npm run typecheck` passes (no `tsc` errors)
3. `npm run lint` passes (no ESLint errors)
4. `npx playwright test` passes (134/134 e2e, plus any new spec you added)
5. **You wrote tests for behavior you changed.** If you fixed a bug,
   there should be a regression test. If you added a feature, there
   should be e2e coverage for the user-visible surface.
6. The PR description explains:
   - **What** changed (one paragraph)
   - **Why** (the user-visible motivation)
   - **How verified** (test count + screenshots if UI)
7. No new dependencies without justification. Especially: no remote-code
   libraries (MV3 bright line).

## Filing issues

- **Bugs**: include browser version, OS, and a minimal reproduction. If
  it's a UI bug, attach a screenshot. If it's a regression, the commit
  hash that broke it (`git log --oneline -- path/to/file`).
- **Feature requests**: describe the user-visible outcome, not the
  implementation. The maintainer will scope.
- **Test gaps**: see [`docs/night-test-audit.md`](docs/night-test-audit.md)
  — many are already tracked there. If you want to close one, that's
  always a welcome PR.

## What's most welcome

- Closing items from `docs/night-test-audit.md` (especially Tier-1 risks)
- New MCP-server integration recipes (for the docs)
- New built-in app cards (open the editor + post a PR with the new app's
  `View` and grid entry)
- Bug fixes with regression tests
- Documentation improvements

## What we'll usually push back on

- Large refactors without a corresponding user benefit
- New dependencies that pull in network code or eval-like surfaces
- Changes that weaken the HITL gate or NFR-SEC-1 key custody
- PRs without tests
- PRs that bundle multiple unrelated changes

## License

By contributing, you agree that your contributions are licensed under the
MIT License (see [`LICENSE`](LICENSE)).
