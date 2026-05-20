import { describe, expect, it } from 'vitest';
import { buildImagePrompt } from './generate';
import { brightnessLut, clampCropRect, rotatedSize, applyBrightnessToPixels } from './canvas';

describe('buildImagePrompt', () => {
  it('trims the prompt and appends style + aspect directives', () => {
    const out = buildImagePrompt({ prompt: '  a fox  ', style: 'photo', aspect: '16:9' });
    expect(out).toBe('a fox. photorealistic photograph, natural lighting, high detail. aspect ratio 16:9');
  });

  it('applies defaults (illustration, 1:1) when omitted', () => {
    const out = buildImagePrompt({ prompt: 'a fox' });
    expect(out).toContain('vector illustration');
    expect(out).toContain('aspect ratio 1:1');
  });

  it('drops an empty base segment without leading separators', () => {
    const out = buildImagePrompt({ prompt: '   ', style: '3d' });
    expect(out.startsWith('.')).toBe(false);
    expect(out).toContain('3D render');
  });

  it('is pure — same input yields same output', () => {
    const req = { prompt: 'mountain', style: 'illustration', aspect: '3:2' } as const;
    expect(buildImagePrompt(req)).toBe(buildImagePrompt(req));
  });
});

describe('clampCropRect', () => {
  it('keeps an in-bounds rect intact', () => {
    expect(clampCropRect({ x: 10, y: 20, width: 30, height: 40 }, 100, 100)).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
  });

  it('clamps negative origin to 0 and shrinks overflow', () => {
    expect(clampCropRect({ x: -5, y: -5, width: 200, height: 200 }, 100, 80)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 80,
    });
  });

  it('clamps an origin past the bounds to a zero-sized rect', () => {
    expect(clampCropRect({ x: 150, y: 150, width: 10, height: 10 }, 100, 100)).toEqual({
      x: 100,
      y: 100,
      width: 0,
      height: 0,
    });
  });

  it('rounds fractional coordinates', () => {
    expect(clampCropRect({ x: 1.6, y: 2.4, width: 3.5, height: 4.5 }, 100, 100)).toEqual({
      x: 2,
      y: 2,
      width: 4,
      height: 5,
    });
  });
});

describe('brightnessLut', () => {
  it('is an identity table at delta 0', () => {
    const lut = brightnessLut(0);
    expect(lut[0]).toBe(0);
    expect(lut[128]).toBe(128);
    expect(lut[255]).toBe(255);
  });

  it('brightens and clamps at the top', () => {
    const lut = brightnessLut(100);
    expect(lut[0]).toBe(255);
    expect(lut[255]).toBe(255);
  });

  it('darkens and clamps at the bottom', () => {
    const lut = brightnessLut(-100);
    expect(lut[255]).toBe(0);
    expect(lut[0]).toBe(0);
  });
});

describe('applyBrightnessToPixels', () => {
  it('maps RGB through the LUT and leaves alpha untouched', () => {
    const pixels = new Uint8ClampedArray([10, 20, 30, 200]);
    applyBrightnessToPixels(pixels, brightnessLut(100));
    expect([pixels[0], pixels[1], pixels[2]]).toEqual([255, 255, 255]);
    expect(pixels[3]).toBe(200);
  });
});

describe('rotatedSize', () => {
  it('swaps width and height', () => {
    expect(rotatedSize(16, 9)).toEqual({ width: 9, height: 16 });
  });
});
