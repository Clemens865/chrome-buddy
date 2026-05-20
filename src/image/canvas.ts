// Canvas edit helpers for Image Studio's basic editor (Pixel Alchemy fold-in,
// research/08 §3). The geometry/pixel math is split into PURE functions that
// are unit-testable without a DOM canvas; the thin wrappers that touch a real
// CanvasRenderingContext2D delegate to them.

import type { CropRect } from './types';

// ---- PURE helpers -----------------------------------------------------------

/**
 * PURE: clamp a requested crop rectangle to the image bounds. Negative origins
 * are pushed to 0, the rect is shrunk so it never exceeds width/height, and a
 * degenerate (<=0) rect collapses to a 0-sized rect at a valid origin. No I/O.
 */
export function clampCropRect(rect: CropRect, width: number, height: number): CropRect {
  const x = Math.min(Math.max(0, Math.round(rect.x)), Math.max(0, width));
  const y = Math.min(Math.max(0, Math.round(rect.y)), Math.max(0, height));
  const maxW = Math.max(0, width - x);
  const maxH = Math.max(0, height - y);
  const w = Math.min(Math.max(0, Math.round(rect.width)), maxW);
  const h = Math.min(Math.max(0, Math.round(rect.height)), maxH);
  return { x, y, width: w, height: h };
}

/**
 * PURE: build a 256-entry brightness lookup table. `delta` is -100..100; each
 * output channel value is the input plus a scaled offset, clamped to 0..255.
 * Index the returned table by the original channel byte to apply brightness.
 */
export function brightnessLut(delta: number): Uint8ClampedArray {
  const offset = Math.round((Math.max(-100, Math.min(100, delta)) / 100) * 255);
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = i + offset; // Uint8ClampedArray clamps
  return lut;
}

/** PURE: dimensions after a 90° rotation (width/height swap). */
export function rotatedSize(width: number, height: number): { width: number; height: number } {
  return { width: height, height: width };
}

/**
 * PURE: apply a brightness LUT to RGBA pixel data in place (alpha untouched).
 * Operates on a raw Uint8ClampedArray so it can be tested without a canvas.
 */
export function applyBrightnessToPixels(
  pixels: Uint8ClampedArray,
  lut: Uint8ClampedArray,
): void {
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = lut[pixels[i]];
    pixels[i + 1] = lut[pixels[i + 1]];
    pixels[i + 2] = lut[pixels[i + 2]];
  }
}

// ---- Canvas-bound wrappers --------------------------------------------------

/**
 * Load an image data URL into a fresh canvas sized to the image. Returns the
 * canvas and its 2D context. Browser-only (uses Image + document).
 */
export async function loadImageToCanvas(
  dataUrl: string,
): Promise<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }> {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = get2dContext(canvas);
  ctx.drawImage(img, 0, 0);
  return { canvas, ctx };
}

/** Crop a canvas to (a clamped) rect, returning a new canvas. */
export function crop(canvas: HTMLCanvasElement, rect: CropRect): HTMLCanvasElement {
  const r = clampCropRect(rect, canvas.width, canvas.height);
  const out = document.createElement('canvas');
  out.width = Math.max(1, r.width);
  out.height = Math.max(1, r.height);
  const ctx = get2dContext(out);
  if (r.width > 0 && r.height > 0) {
    ctx.drawImage(canvas, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
  }
  return out;
}

/** Rotate a canvas 90° clockwise, returning a new (size-swapped) canvas. */
export function rotate90(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const size = rotatedSize(canvas.width, canvas.height);
  const out = document.createElement('canvas');
  out.width = size.width;
  out.height = size.height;
  const ctx = get2dContext(out);
  ctx.translate(out.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(canvas, 0, 0);
  return out;
}

/** Adjust brightness of a canvas in place by `delta` (-100..100). */
export function adjustBrightness(ctx: CanvasRenderingContext2D, delta: number): void {
  const { canvas } = ctx;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  applyBrightnessToPixels(image.data, brightnessLut(delta));
  ctx.putImageData(image, 0, 0);
}

// ---- internals --------------------------------------------------------------

function get2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context is unavailable.');
  return ctx;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image.'));
    img.src = dataUrl;
  });
}
