// Image Studio types (App #2 — research/08 §5). The capability is built once and
// exposed three ways (app UI, agent tool, skill); these are its shared shapes.

/** Aspect ratios offered by the prompt bar / generate_image tool. */
export type AspectRatio = '1:1' | '3:2' | '16:9' | '9:16';

/** Generation style presets that bias the prompt. */
export type ImageStyle = 'photo' | 'illustration' | '3d';

/** A request to generate an image (Imagen 4 / Nano Banana — research/03 §4). */
export interface GenerateRequest {
  /** Natural-language description of the image to generate. */
  prompt: string;
  /** Target aspect ratio. Defaults to 1:1 when omitted. */
  aspect?: AspectRatio;
  /** Style preset that conditions the prompt. Defaults to illustration. */
  style?: ImageStyle;
}

/** A single canvas edit operation applied to the working image. */
export type EditOp =
  | { kind: 'crop'; rect: CropRect }
  | { kind: 'rotate90' }
  | { kind: 'brightness'; /** -100..100; 0 is a no-op. */ delta: number };

/** A pixel-space rectangle (origin top-left). */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Provenance / accounting metadata attached to a generated image. */
export interface GeneratedImageMeta {
  /** Registry model id that produced the image. */
  model: string;
  /** Aspect ratio requested. */
  aspect: AspectRatio;
  /** Style preset requested. */
  style: ImageStyle;
  /** Epoch millis the image was produced. */
  createdAt: number;
}

/** A generated image plus the prompt + metadata that produced it. */
export interface GeneratedImage {
  /** `data:` URL of the encoded image (PNG/JPEG). */
  dataUrl: string;
  /** The (built) prompt that produced this image. */
  prompt: string;
  meta: GeneratedImageMeta;
}

/** Structured outcome of a generation attempt; never throws for expected modes. */
export type GenerateOutcome =
  | { ok: true; image: GeneratedImage }
  | { ok: false; reason: GenerateErrorReason; message: string };

/** Why a generation failed, in a form the UI can branch on. */
export type GenerateErrorReason =
  /** No API key set — the UI should prompt the user to add one in Settings. */
  | 'no-key'
  /** The model/background returned no usable image payload. */
  | 'no-image'
  /** Any other runtime/network failure. */
  | 'error';
