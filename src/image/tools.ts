// Image Studio registry tools (research/08 §5): the same capabilities the app
// UI uses, exposed to the agent + skills via the one shared Tool Registry
// (FR-TOOLS-1, "build once, expose three ways"). generate_image is not
// consequential (no external side effect beyond a metered API call); edit_image
// is a local pixel transform, also not consequential.

import { ok, err, type ToolResult } from '../types';
import type { JSONSchema } from '../types';
import type { ToolRegistry } from '../tools/registry';
import type { ToolDefinition } from '../tools/types';
import { generateImage } from './generate';
import { clampCropRect } from './canvas';
import type { AspectRatio, CropRect, ImageStyle } from './types';

const ASPECTS: AspectRatio[] = ['1:1', '3:2', '16:9', '9:16'];
const STYLES: ImageStyle[] = ['photo', 'illustration', '3d'];

const generateSchema: JSONSchema = {
  type: 'object',
  properties: {
    prompt: { type: 'string', description: 'Description of the image to generate.' },
    aspect: { type: 'string', enum: [...ASPECTS], description: 'Aspect ratio.', default: '1:1' },
    style: { type: 'string', enum: [...STYLES], description: 'Visual style preset.', default: 'illustration' },
  },
  required: ['prompt'],
  additionalProperties: false,
};

const editSchema: JSONSchema = {
  type: 'object',
  properties: {
    op: {
      type: 'string',
      enum: ['crop', 'rotate90', 'brightness'],
      description: 'The edit operation to apply.',
    },
    rect: {
      type: 'object',
      description: 'Crop rectangle in pixels (required when op = crop).',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
      },
      required: ['x', 'y', 'width', 'height'],
      additionalProperties: false,
    },
    delta: {
      type: 'number',
      description: 'Brightness delta -100..100 (required when op = brightness).',
    },
    width: { type: 'number', description: 'Source image width in pixels (for crop clamping).' },
    height: { type: 'number', description: 'Source image height in pixels (for crop clamping).' },
  },
  required: ['op'],
  additionalProperties: false,
};

interface GenerateArgs {
  prompt?: unknown;
  aspect?: unknown;
  style?: unknown;
}

interface EditArgs {
  op?: unknown;
  rect?: Partial<CropRect>;
  delta?: unknown;
  width?: unknown;
  height?: unknown;
}

function asAspect(v: unknown): AspectRatio | undefined {
  return typeof v === 'string' && (ASPECTS as string[]).includes(v) ? (v as AspectRatio) : undefined;
}
function asStyle(v: unknown): ImageStyle | undefined {
  return typeof v === 'string' && (STYLES as string[]).includes(v) ? (v as ImageStyle) : undefined;
}

const generateTool: ToolDefinition = {
  name: 'generate_image',
  description: 'Generate an image from a text prompt (Nano Banana / gemini-2.5-flash-image). Returns a data URL.',
  paramsSchema: generateSchema,
  consequential: false,
  async handler(args): Promise<ToolResult> {
    const a = args as GenerateArgs;
    if (typeof a.prompt !== 'string' || a.prompt.trim().length === 0) {
      return err('invalid-args', 'A non-empty "prompt" is required.');
    }
    const outcome = await generateImage({
      prompt: a.prompt,
      aspect: asAspect(a.aspect),
      style: asStyle(a.style),
    });
    if (!outcome.ok) {
      const code = outcome.reason === 'no-key' ? 'not-allowed' : 'runtime-error';
      return err(code, outcome.message);
    }
    return ok({ dataUrl: outcome.image.dataUrl, prompt: outcome.image.prompt, meta: outcome.image.meta });
  },
};

// edit_image computes the deterministic parameters of an edit (clamped crop
// rect, validated brightness delta, rotation flag). The actual pixel work runs
// on a canvas in the app/offscreen context; here we validate + normalize so the
// same op shape is reusable by the agent.
const editTool: ToolDefinition = {
  name: 'edit_image',
  description: 'Apply a basic image edit (crop, rotate 90°, or brightness). Returns the normalized, validated operation.',
  paramsSchema: editSchema,
  consequential: false,
  async handler(args): Promise<ToolResult> {
    const a = args as EditArgs;
    switch (a.op) {
      case 'crop': {
        const rect = a.rect;
        const w = typeof a.width === 'number' ? a.width : undefined;
        const h = typeof a.height === 'number' ? a.height : undefined;
        if (
          !rect ||
          typeof rect.x !== 'number' ||
          typeof rect.y !== 'number' ||
          typeof rect.width !== 'number' ||
          typeof rect.height !== 'number'
        ) {
          return err('invalid-args', 'crop requires a rect {x,y,width,height}.');
        }
        if (w === undefined || h === undefined) {
          return err('invalid-args', 'crop requires source width and height for clamping.');
        }
        return ok({ op: 'crop', rect: clampCropRect(rect as CropRect, w, h) });
      }
      case 'rotate90':
        return ok({ op: 'rotate90' });
      case 'brightness': {
        if (typeof a.delta !== 'number') {
          return err('invalid-args', 'brightness requires a numeric "delta".');
        }
        const delta = Math.max(-100, Math.min(100, a.delta));
        return ok({ op: 'brightness', delta });
      }
      default:
        return err('invalid-args', `Unknown edit op "${String(a.op)}".`);
    }
  },
};

/** Register the Image Studio tools into the shared registry. */
export function registerImageTools(registry: ToolRegistry): void {
  registry.register(generateTool);
  registry.register(editTool);
}
