// Image generation for Image Studio. The prompt-building is a PURE function
// (unit-tested without network); the actual call is routed through the
// background service worker so the API key never enters a UI/content context
// (research/03 §7 "cloud calls from background SW"; PRD NFR-SEC-1/2).

import { generateImageViaBackground } from '../llm/instance';
import type { GenerateResult } from '../llm/client';
import type {
  AspectRatio,
  GenerateOutcome,
  GenerateRequest,
  ImageStyle,
} from './types';

/** Nano Banana — Gemini's stable image gen/edit model (research/03 §4). */
export const IMAGE_MODEL = 'gemini-2.5-flash-image';

const DEFAULT_ASPECT: AspectRatio = '1:1';
const DEFAULT_STYLE: ImageStyle = 'illustration';

/** Human-readable style fragments appended to the user's prompt. */
const STYLE_HINT: Record<ImageStyle, string> = {
  photo: 'photorealistic photograph, natural lighting, high detail',
  illustration: 'clean vector illustration, flat color, crisp edges',
  '3d': '3D render, soft studio lighting, subtle ambient occlusion',
};

/**
 * PURE: assemble the final generation prompt from a request. Trims the user
 * text, appends the style hint and an explicit aspect-ratio directive (image
 * models read the ratio from text on the openai-compatible endpoint). Stable
 * output for a given input — safe to unit-test.
 */
export function buildImagePrompt(req: GenerateRequest): string {
  const base = req.prompt.trim();
  // Edit mode: the prompt is an instruction applied to inputImage. Keep the
  // existing composition + dimensions; don't append style/aspect directives.
  if (req.inputImage) {
    return `Edit the provided image: ${base}. Keep the overall composition unless the instruction says otherwise; return only the edited image.`;
  }
  const style = req.style ?? DEFAULT_STYLE;
  const aspect = req.aspect ?? DEFAULT_ASPECT;
  const parts = [base, STYLE_HINT[style], `aspect ratio ${aspect}`];
  return parts.filter((p) => p.length > 0).join('. ');
}

/** True for a string that looks like an inline image data URL. */
function isImageDataUrl(value: unknown): value is string {
  return typeof value === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(value);
}

/**
 * Best-effort extraction of an image data URL from a normalized generation
 * result. The openai-compatible endpoint can surface image bytes in a few
 * shapes, so we probe defensively: the response text itself (when it is a data
 * URL), then known fields in the raw payload (`b64_json` / `images[]`). Returns
 * undefined when no image is present.
 */
export function extractImageDataUrl(result: GenerateResult): string | undefined {
  if (isImageDataUrl(result.text)) return result.text;

  const raw = result.raw;
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;

  // data: [{ b64_json | url }] (images API shape)
  const data = r['data'];
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0] as Record<string, unknown> | undefined;
    const url = first?.['url'];
    if (isImageDataUrl(url)) return url;
    const b64 = first?.['b64_json'];
    if (typeof b64 === 'string' && b64.length > 0) return `data:image/png;base64,${b64}`;
  }

  // images: ["data:image/..."] (some chat-image responses)
  const images = r['images'];
  if (Array.isArray(images) && isImageDataUrl(images[0])) return images[0];

  return undefined;
}

/** Map a thrown error to a structured no-key vs generic failure reason. */
function classifyError(message: string): 'no-key' | 'error' {
  return /\bkey\b/i.test(message) || /unauthor/i.test(message) || /401/.test(message)
    ? 'no-key'
    : 'error';
}

/**
 * Generate an image via the background SW. Degrades gracefully: returns a
 * structured outcome instead of throwing, so the UI can render a clear
 * "needs API key" state when no key is configured.
 */
export async function generateImage(req: GenerateRequest): Promise<GenerateOutcome> {
  const prompt = buildImagePrompt(req);
  const aspect = req.aspect ?? DEFAULT_ASPECT;
  const style = req.style ?? DEFAULT_STYLE;

  try {
    // Image models use the native generateContent endpoint, not the chat adapter.
    const dataUrl = await generateImageViaBackground({
      model: IMAGE_MODEL,
      prompt,
      aspect,
      ...(req.inputImage ? { inputImage: req.inputImage } : {}),
    });
    if (!dataUrl) {
      return {
        ok: false,
        reason: 'no-image',
        message: 'The model did not return an image. Try refining the prompt.',
      };
    }

    return {
      ok: true,
      image: {
        dataUrl,
        prompt,
        meta: { model: IMAGE_MODEL, aspect, style, createdAt: Date.now() },
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const reason = classifyError(message);
    return {
      ok: false,
      reason,
      message:
        reason === 'no-key'
          ? 'Add an API key in Settings to generate images.'
          : message,
    };
  }
}
