// Gemini Nano on-device path (FR-LLM-8, NFR-PRIV-2). Chrome's built-in Prompt
// API (`LanguageModel`) runs a small model fully on-device — no network egress —
// for short/private tasks. It exists only in a window context (panel/content),
// NEVER the service worker, and isn't always available, so every caller MUST
// fall back to the cloud. Pure feature-detection + a thin prompt wrapper.

interface LanguageModelSession {
  prompt(input: string): Promise<string>;
  destroy?: () => void;
}
interface LanguageModelStatic {
  availability?: () => Promise<string>;
  create: (opts?: unknown) => Promise<LanguageModelSession>;
}

function lm(): LanguageModelStatic | undefined {
  if (typeof globalThis === 'undefined') return undefined;
  const g = globalThis as unknown as { LanguageModel?: LanguageModelStatic; ai?: { languageModel?: LanguageModelStatic } };
  return g.LanguageModel ?? g.ai?.languageModel;
}

/** Whether the on-device Prompt API exists in this context. */
export function isNanoSupported(): boolean {
  return lm() !== undefined;
}

/** Availability state ('available' | 'downloadable' | 'downloading' | 'unavailable' | …). */
export async function nanoAvailability(): Promise<string> {
  const m = lm();
  if (!m) return 'unavailable';
  try {
    return (await m.availability?.()) ?? 'available';
  } catch {
    return 'unavailable';
  }
}

/**
 * Run a short prompt on-device. Returns the text, or null when unavailable / on
 * any error — the caller must then fall back to the cloud.
 */
export async function nanoPrompt(text: string): Promise<string | null> {
  const m = lm();
  if (!m || !text.trim()) return null;
  const avail = await nanoAvailability();
  if (avail !== 'available' && avail !== 'readily') return null;
  try {
    const session = await m.create();
    const out = await session.prompt(text);
    session.destroy?.();
    return out?.trim() || null;
  } catch {
    return null;
  }
}
