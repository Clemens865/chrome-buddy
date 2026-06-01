# Blueprint — Buddy Marketplace (safe plugin/app catalog)

> A discover/install/update marketplace for Chrome Buddy artifacts (apps, skills,
> workflows), hosted as a public GitHub repo we own and keep adding to. Status:
> **design approved; building read side.**

## 1. The one idea that makes it work

It's a **marketplace of DATA, not code.** Entries are app *configs* / skill
*prompts* / workflow *definitions*. Any JS (Tier-2/3 apps) runs **only in the
opaque-origin sandbox** (no `chrome.*`, no key access, no ambient network),
behind the permission bridge + the first-run **review gate** + consequential
**HITL**. So we get every marketplace benefit — discover, one-tap install,
auto-update, publish — without the thing that makes marketplaces dangerous
(malware / supply-chain / RCE). Post-"prompts become shells," this is the *only*
safe way to ship a plugin marketplace for an AI agent. It's the Agent-Zero wedge
made concrete: their hub installs code with host privileges; ours installs data
that can't escape the sandbox.

## 2. Why an official repo (not bundled, not "any repo" yet)

- **We are the supplier** — no cold-start: we seed it with apps we've already
  built and add more continuously.
- **Ship/iterate apps WITHOUT an extension release** — push to the repo →
  versioned entries → users see "Update available". The decisive advantage a
  bundled set can't give.
- Bundled set → shrinks to a tiny *offline default*. "Import from any repo /
  SKILL.md" → a later power feature. Community publish (PRs) → later.

## 3. Repo shape (the catalog = a public GitHub repo)

```
chrome-buddy-catalog/                  (public, we own, PR-curated)
  index.json    [{ id, name, description, kind:'app'|'skill'|'workflow',
                   tier?, version, permissions:[], author?, screenshot?,
                   dataPath, sha }]
  apps/*.json        (an AppBundle: { schemaVersion, apps:[AppConfig] })
  skills/*.md|*.json
  workflows/*.json
```

- **Read (browse/install)** → direct `raw.githubusercontent.com` fetch. **No
  auth, no PAT, no MCP, no LLM round-trip.** Public data.
- **Write (publish)** → `github_write` opens a **PR** to the repo (PR review =
  curation). Later; v1 = we publish by committing.

## 4. Install / update / safety

- Install: fetch entry data → **`parseAppBundle`** (apps) re-validates: reassigns
  ids, allowlists capabilities, forces `reviewed:false` → review gate runs before
  first execution. Skills/workflows use their bundle parsers. Verify entry `sha`.
- Update: installed artifact carries a `version`; catalog has newer → "Update
  available" → re-install (re-validated).
- Safety invariants (unchanged): sandbox isolation, permissions shown before
  install, consequential caps never auto-authorized, review gate first run.

## 5. Chrome Web Store framing (design constraint, not blocker)

The Web Store restricts remotely-loaded **code** that adds functionality. Stay
clearly safe by: **Tier-1 apps (pure form+prompt, zero JS)** are unconditionally
fine to deliver remotely; **Tier-2/3 (JS)** are framed + implemented as **"the
user explicitly installs an artifact that runs sandboxed"** (identical to
importing a file today) — user-tapped install, `sha`-verified, review-gated — not
"the extension auto-loads remote code." Seed the catalog Tier-1-first.

## 6. Components / roadmap

- **Slice 1 (this):** `src/catalog/` — types, `parseCatalogIndex` (tolerant,
  drops bad entries), `compareVersions`/`isUpdateAvailable`, `fetchIndex`/
  `fetchEntry` (raw HTTPS, injectable). Seed `index.json` + a Tier-1 entry.
- **Slice 2:** `installEntry` (reuse `parseAppBundle` + skill/workflow parsers)
  + the **Discover** gallery in Apps (cards → Install → "Update available").
- **Slice 3:** `search_catalog` agent tool + an **Install card** in chat (the
  conversational flow).
- **Slice 4:** publish via `github_write` PR; "import from any trusted repo /
  SKILL.md"; usage counts.

## 7. Open questions

1. Catalog base URL — pin to one repo/branch in config; allow override later?
2. `sha` verification — index carries each entry's content sha; reject on
   mismatch (tamper guard) — confirm the hash we store/compare.
3. Update UX — auto-check on Discover open vs. a manual "check for updates".
4. Skills portability — a `SKILL.md` expecting tools Buddy lacks should surface
   "expects unavailable tools", not fail silently.
