// Vector tracing for the `trace` capability: a raster icon (from bridge.image)
// → a clean, croppable SVG via imagetracerjs. This is the pipeline the MicroLabs
// SVG generator uses (image-gen → trace) and the reason its icons look far
// better than text-model-authored SVG paths.
//
// Runs in the HOST (SandboxAppFrame) — it needs a DOM + canvas for tracing and
// getBBox for the whitespace crop, which the opaque-origin sandbox app can't do.

import ImageTracer from 'imagetracerjs';

// Ultra-high-fidelity settings (ported from the original) for smooth curves +
// a 2-colour (black/white) quantization so we can drop the background.
const TRACE_OPTIONS = {
  ltres: 0.01,
  qtres: 0.01,
  scale: 10,
  roundcoords: 3,
  pathomit: 4,
  rightangleenhance: true,
  colorsampling: 0,
  numberofcolors: 2,
  mincolorratio: 0,
  colorquantcycles: 1,
  blurradius: 1,
  blurdelta: 20,
  lcpr: 0,
  qcpr: 0,
  desc: false,
  viewbox: true,
};

function isWhite(color: string | null): boolean {
  if (!color) return false;
  const c = color.toLowerCase().trim();
  return c === '#fff' || c === '#ffffff' || c === 'white' || c.includes('255,255,255');
}

/** Drop the white background, set currentColor, and crop the viewBox to the
 *  drawn content. Returns the cleaned SVG, or the input if anything fails. */
function cleanTracedSvg(svgString: string): string {
  try {
    const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return svgString;
    const svg = doc.querySelector('svg');
    if (!svg) return svgString;

    svg.querySelectorAll('path, rect, circle, polygon').forEach((el) => {
      if (isWhite(el.getAttribute('fill'))) {
        el.remove();
      } else {
        el.setAttribute('fill', 'currentColor');
        el.removeAttribute('stroke-width');
        el.removeAttribute('id');
      }
    });

    // Measure the drawn content off-screen to crop the viewBox to it.
    const container = document.createElement('div');
    Object.assign(container.style, { position: 'absolute', visibility: 'hidden', top: '-9999px', left: '-9999px', width: '20000px', height: '20000px' });
    const tempSvg = svg.cloneNode(true) as SVGSVGElement;
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    while (tempSvg.firstChild) group.appendChild(tempSvg.firstChild);
    tempSvg.appendChild(group);
    container.appendChild(tempSvg);
    document.body.appendChild(container);
    try {
      const bbox = group.getBBox();
      if (bbox.width > 0 && bbox.height > 0) {
        const pad = Math.max(bbox.width, bbox.height) * 0.02;
        svg.setAttribute('viewBox', `${(bbox.x - pad).toFixed(2)} ${(bbox.y - pad).toFixed(2)} ${(bbox.width + pad * 2).toFixed(2)} ${(bbox.height + pad * 2).toFixed(2)}`);
      }
    } finally {
      document.body.removeChild(container);
    }

    svg.removeAttribute('width');
    svg.removeAttribute('height');
    return svg.outerHTML.replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><');
  } catch {
    return svgString;
  }
}

/** Trace a raster data URL to a cleaned SVG string. Rejects on load/timeout. */
export function traceToSvg(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Tracing timed out.')), 30_000);
    try {
      ImageTracer.imageToSVG(
        dataUrl,
        (svgString: string) => {
          clearTimeout(timeout);
          if (!svgString) { reject(new Error('Tracing returned empty SVG.')); return; }
          resolve(cleanTracedSvg(svgString));
        },
        TRACE_OPTIONS,
      );
    } catch (e) {
      clearTimeout(timeout);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}
