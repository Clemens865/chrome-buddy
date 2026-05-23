# Gemini Findings for Chrome Buddy

A condensed, code-mapped view of what's in `/Users/clemenshoenig/Documents/Software-Projects/Google_Geminin_documentation/` (79 docs, ~2 MB) and what it means for our app. Generated 2026-05-23 from 7 parallel deep-read passes (one per category).

## Files in this folder

- **`action-items.md`** — Prioritized actionable list (MUST FIX → HIGH-VALUE → OPTIMIZATIONS → NICE-TO-HAVE) with concrete code locations. Start here.
- **`findings-by-category.md`** — Full per-category findings with doc references and section line numbers.

## Headline (read this first)

1. **Today + 27 days (2026-06-19): unrestricted API keys stop working.** Need an onboarding nudge. `api-key.md`.
2. **`temperature: 0.7` on every Gemini-3 model causes loops** (`docs/troubleshooting.md` L76 note). We set this in `src/llm/registry.default.ts:43,55,67,81,93,105,117,131` for every model. Must drop to `1.0` (default) for `gemini-3*` IDs.
3. **`safetySettings` defaults are OFF on Gemini 2.5/3** (`safety-settings.md` L65, L82-83). We never set them. Effective production risk.
4. **Thought signatures are mandatory on Gemini 3 function calling**; missing them → silent 400s when we migrate. Our `geminiNative.ts` is a stub; the OpenAI-compat path drops `extra_content.google.thought_signature`. Fix before the model bump.
5. **`gemini-2.5-flash` shuts down 2026-10-16** (~5 months) — plan migration to `gemini-3.5-flash`.
6. **Built-ins we're rolling our own for** (largest capability win): `googleSearch` grounding (vs our `search_web`), `urlContext` (vs `read_dom+navigate`), `fileSearch` (vs nothing), `codeExecution` (vs our Tier-2 sandbox), `computerUse` (we have a stub).
7. **Biggest cheap cost win**: implicit caching (zero code, just reorder prompts: stable prefix → volatile user turn) ≈ 90% off cached input tokens.

## How to use these files

- Working on the LLM client / adapter? Read `action-items.md` §MUST FIX + §HIGH-VALUE.
- Working on a new tool? Check `findings-by-category.md` → Category C to see if Gemini has a built-in.
- Costs / billing question? `action-items.md` §OPTIMIZATIONS.
- Privacy / safety / disclosure question? `findings-by-category.md` → Category G.

## Source-doc navigation

The Gemini docs folder has its own `README.md` (a quick-find table by topic) — open `/Users/clemenshoenig/Documents/Software-Projects/Google_Geminin_documentation/README.md` to jump to a specific source doc.
