# Gemini API Models & Chrome Built-in AI — Reference (May 2026)

> Sources: ai.google.dev/gemini-api/docs/{models,pricing,rate-limits,api-key}, developer.chrome.com/docs/ai, `@google/genai` SDK.
> ⚠️ Lineup moves fast — preview model IDs and the paid-only policy (several 2.5 models since 2026-04-01) drift most.

## 1. Text / Reasoning Models

### Gemini 3.1 Pro — flagship reasoning
- **ID**: `gemini-3.1-pro-preview` (3-pro lineage GA)
- **For**: Advanced intelligence, complex problem-solving, agentic + "vibe" coding. Most capable reasoning model.
- **Caps**: Multimodal in (text/image/video/audio/PDF), text out; function calling, structured output, search grounding, code execution, thinking, context caching, batch.
- **Context**: ~2,000,000 in / ~64K out (docs vary 1M–2M).
- **Cutoff**: Jan 2025.
- **Price (paid only)**: in $2.00/1M (≤200K) → $4.00 (>200K); out $12.00 → $18.00; cached in $0.20. Batch ≈50% off.
- **Status**: Preview. Free tier removed 2026-04-01.

### Gemini 3.5 Flash — most intelligent Flash ⭐ (recommended default)
- **ID**: `gemini-3.5-flash` (`3.5-flash-05-2026`)
- **For**: Google's "strongest agentic and coding model yet" (per [blog.google](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-5/), released 2026). Excels at complex long-horizon agentic tasks. Beats 3.1 Pro on agentic/coding; trails on hardest pure reasoning (HLE 40.2% vs 44.4%). ~4× faster output-tokens/sec than other frontier models.
- **Confirmed benchmarks (blog)**: Terminal-Bench 2.1 **76.2%**, GDPval-AA **1656 Elo**, MCP Atlas **83.6%**, CharXiv Reasoning **84.2%** (multimodal). "Frontier-level intelligence at exceptional speed."
- **Availability (blog)**: shipping "today to billions globally" via Gemini app, Search, Google Antigravity, **Gemini API**, and enterprise platforms.
- **Caps**: text+image+audio+video in, text out; richer interactive web UI/graphics generation; dynamic thinking (on by default), function calling, structured output, search grounding, code execution.
- **Context**: 1,048,576 in / 65,536 out. **Cutoff**: Jan 2026 (not stated in blog; from model card).
- **Price**: in $1.50/1M, out $9.00/1M, cached in $0.15. Batch $0.75 / $4.50.
- **Status**: **GA/Stable**. Free tier w/ reduced quota. Built per Google's Frontier Safety Framework (strengthened cyber/CBRN safeguards).

### Gemini 3 Flash — high-value thinking
- **ID**: `gemini-3-flash-preview`
- **For**: Near-Pro reasoning/tool use at much lower latency; agentic workflows, multi-turn chat, coding assist.
- **Caps**: text/image/video/audio in, text out; thinking, function calling, structured output, grounding, code execution.
- **Context**: 1,048,576 in / 65,536 out.
- **Price**: in $0.50/1M (text/img/video), $1.00 (audio); out $3.00.
- **Status**: Preview. Free tier (reduced).

### Gemini 3.1 Flash-Lite — cheapest budget
- **ID**: `gemini-3.1-flash-lite`
- **For**: Frontier-class at lowest cost; cheapest Tier-1 budget model.
- **Caps**: multimodal in, text out; function calling, structured output, thinking, grounding.
- **Price**: in $0.25/1M (text/img/video), $0.50 (audio); out $1.50. Batch 50% off.
- **Status**: Stable + Preview variants. Free tier retained (reduced).

### Legacy 2.5 family (paid-only since 2026-04-01)
| Model | ID | Context | Price in/out (/1M) | Note |
|-------|-----|---------|--------------------|------|
| 2.5 Pro | `gemini-2.5-pro` | ~1M / 64K | $1.25→2.50 / $10→15 | Deep reasoning, legacy |
| 2.5 Flash | `gemini-2.5-flash` | ~1M / 64K | $0.30 / $2.50 (audio $1.00 in) | Proven workhorse |
| 2.5 Flash-Lite | `gemini-2.5-flash-lite` | ~1M / 64K | $0.10 / $0.40 (audio $0.30 in) | Cheapest overall |

> Roadmap: **Gemini 3.5 Pro** — confirmed by [blog.google](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-5/) as "already being used internally… rolling it out next month" (i.e. ~June 2026).

## 2. Live API / Real-Time Audio (WebSockets)

| Model | ID | Notes |
|-------|-----|-------|
| 3.1 Flash Live | `gemini-3.1-flash-live` (preview) | Low-latency dialogue/voice. Audio $3.00 in (or $0.005/min) / $12.00 out (or $0.018/min). Free tier. |
| 2.5 Flash Native Audio | `gemini-2.5-flash-native-audio-preview-12-2025` | Sub-second native audio streaming. |
| 3.1 Flash TTS | `gemini-3.1-flash-tts-preview` | $1.00 in / $20.00 out. |
| 2.5 Flash TTS | `gemini-2.5-flash-preview-tts` | $0.50 in / $10.00 out. |

## 3. Embeddings

| Model | ID | Price | Note |
|-------|-----|-------|------|
| Gemini Embedding 2 | `gemini-embedding-2` | text $0.20, image $0.45, audio $6.50, video $12.00 /1M | First multimodal embeddings (unified space). Free tier. |
| Gemini Embedding | `gemini-embedding-001` | $0.15/1M (batch $0.075) | Text semantic search / classification / RAG. |

## 4. Image Generation (Nano Banana / Imagen)

| Model | ID | Price | Status |
|-------|-----|-------|--------|
| Nano Banana 2 | (preview) | high-volume gen/edit | Preview |
| Nano Banana Pro | (preview) | SOTA contextual native | Preview |
| Nano Banana | `gemini-2.5-flash-image` | in $0.30/1M; ~$0.039/image | Stable |
| 3.1 Flash Image | `gemini-3.1-flash-image-preview` | in $0.50/1M; out $3.00/1M text + $60/1M image tok | Preview |
| Imagen 4 | `imagen-4...` | Fast $0.02 / Std $0.04 / Ultra $0.06 per img | Stable |

(Video Veo 3.1, Music Lyria 3 — out of scope for an LLM extension.)

## 5. Specialized (relevant to extensions)
- **Computer Use** — `gemini-2.5-computer-use-preview-10-2025`: sees a screen, performs UI actions (click/type/navigate). **Directly relevant for browser automation.** $1.25/$10 per 1M. Preview.
- **Deep Research / Deep Research Max** — agentic multi-source cited reports. Preview.
- **Antigravity Agent** — managed sandbox agent (code/files/browsing). Preview.

## 6. Gemini Nano & Chrome Built-in AI (on-device) ⭐

Runs **Gemini Nano locally** — no API key, no network, no per-token cost, private, offline after one-time download.

| API | Surface | Purpose |
|-----|---------|---------|
| Prompt API | `LanguageModel` | General prompting (multimodal: text+image+audio in) |
| Summarizer | `Summarizer` | Summaries (sentences/bullets/paragraphs) |
| Writer | `Writer` | Generate content |
| Rewriter | `Rewriter` | Adjust length/tone |
| Translator | `Translator` | On-device translation |
| Language Detector | `LanguageDetector` | Detect language |
| Proofreader | `Proofreader` | Grammar/readability |

```js
const avail = await LanguageModel.availability({
  expectedInputs: [{type:'text', languages:['en']}],
  expectedOutputs:[{type:'text', languages:['en']}]
});
const session = await LanguageModel.create({ temperature: 1.0, topK: 32 });
const out = await session.prompt(msg, { responseConstraint: schema }); // JSON schema = structured output
```

### ⚠️ CRITICAL extension constraint
- **Works in content scripts / extension pages (popup, offscreen doc).**
- **Does NOT work in service/web workers** — so a Manifest V3 background worker **cannot** call on-device AI. On-device must run in a content script or offscreen document, with message passing to the background.

### Limits & hardware
- Tiny model: **~1,024 tokens/prompt**, session ~4,096–6,000 total. Rule of thumb: **<500 tok in / <200 tok out**, recoverable tasks only.
- Good for: summarize, classify, rewrite, tag, short extraction, proofread, light chat, translate. **Bad for**: long-doc QA, code gen, heavy reasoning.
- Status: origin trial Chrome 138+, stable ~148+; available in extensions now.
- Hardware: Win10/11, macOS 13+, Linux, ChromeOS 16389+; >4 GB VRAM or 16 GB RAM + 4 cores; ~22 GB disk.

## 7. Auth, SDK & Browser Security

### SDK `@google/genai`
```js
import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: KEY });
const res = await ai.models.generateContent({ model:'gemini-3.5-flash', contents:'...' });
console.log(res.text);
```
Docs warn twice: **avoid exposing API keys in client-side code; use server-side in production.**

### CORS / architecture
- `generativelanguage.googleapis.com` is callable from browser with a key — **CORS is not the blocker; key exposure is.** A bundled key is extractable from an unpacked extension.
- **Two safe patterns**:
  1. **BYO key** → user pastes key → store in `chrome.storage.session` → call from **background service worker** (network OK there; keeps key out of page DOM a content script shares with the site).
  2. **Proxy backend** (or Firebase AI Logic) → real key never reaches client; restrict + quota the key.
- **Architecture rule**: **cloud** calls from **background SW** (key hygiene); **on-device Nano** from **content script / offscreen doc** (Nano unavailable in SW). Message-pass between them.
- Live API uses WebSockets — SWs can't easily proxy without monkey-patching global `WebSocket`.

### Free tier & rate limits (per project, reset midnight PT)
| Tier | Limits |
|------|--------|
| Free | 2.5 Pro 5 RPM/~50–100 RPD · 2.5 Flash 10 RPM/250 RPD · 2.5 Flash-Lite 15–30 RPM/1,000 RPD · ~250K TPM shared. 3.1 Pro + all 2.5 are **paid-only** since 2026-04-01; 3 Flash & 3.1 Flash-Lite have reduced free quota. |
| Tier 1 (billing on) | ~300 RPM, 1M TPM, 1,000+ RPD. |

Free-tier prompts may be used for training; paid & Vertex are not.

## 8. Recommendations for Chrome_Buddy

**Default workhorse → `gemini-3.5-flash` (GA)**: frontier reasoning, beats 3.1 Pro on coding/agentic, 1M context, multimodal, ~4× faster, moderate $1.50/$9.

| Job | Model | Why |
|-----|-------|-----|
| Fast UI-latency (inline, tooltips, quick summary) | `gemini-3.1-flash-lite` or `gemini-2.5-flash-lite` | Lowest latency+cost |
| Deep reasoning (hard analysis/coding/multi-step) | `gemini-3.1-pro-preview` | Highest reasoning, 2M ctx; reserve (8× output cost) |
| Cheap high-volume (classify/tag/bulk extract) | `gemini-2.5-flash-lite` ($0.10/$0.40) | Cheapest cloud |
| On-device / offline / privacy / $0 | **Gemini Nano (Prompt/Summarizer/Translator)** | No key/cost, private; <500/<200 tok; content script only |
| Voice / real-time | `gemini-3.1-flash-live` | Low-latency audio |
| Browser automation | `gemini-2.5-computer-use-preview-10-2025` | Purpose-built to drive UIs |
| Semantic search / RAG over saved pages | `gemini-embedding-001` / `gemini-embedding-2` | Cheap embeddings |

**Tiered fallback strategy**: (1) try Nano on-device for small tasks — feature-detect `LanguageModel.availability()`, always have cloud fallback; (2) everyday cloud → 3.1 Flash-Lite (latency) or 3.5 Flash (quality); (3) escalate to 3.1 Pro only for hard requests; (4) use batch (≈50% off) for non-interactive bulk + context caching (cached ≈10%) for repeated large contexts.

**Security takeaway**: never bundle a hard-coded key. BYO key in `storage.session`, call from background SW — or proxy via own backend / Firebase AI Logic. Cloud in background, Nano in content/offscreen.
