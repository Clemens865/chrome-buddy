// Built-in Tier-3 sandbox-UI app: an SVG Icon Generator.
//
// This is the P1 PROOF that a true micro-app — its own interactive UI +
// capabilities — runs as DATA injected into the opaque-origin sandbox iframe
// (no source-file writes, no remote code). It mirrors the MicroLabs SVG-icon
// benchmark in miniature: prompt → style → N variations via bridge.gemini →
// rendered gallery → per-icon SVG download via api.download.
//
// The same shape is what the conversational builder (later phase) will emit;
// here it's hand-authored to validate the runtime end-to-end.
import type { AppConfig } from '../types';

const html = `
<div class="wrap">
  <p class="hint">Describe an icon; Buddy generates inline SVG you can render and download.</p>
  <textarea id="desc" rows="2" placeholder="e.g. a rocket launching"></textarea>
  <div class="row">
    <select id="style" aria-label="Style">
      <option value="line">Line</option>
      <option value="solid">Solid</option>
      <option value="duotone">Duotone</option>
      <option value="flat">Flat</option>
    </select>
    <select id="count" aria-label="Variations">
      <option value="1">1</option>
      <option value="2">2</option>
      <option value="4">4</option>
    </select>
    <button id="go" type="button">Generate</button>
  </div>
  <div id="status" class="status"></div>
  <div id="gallery" class="gallery"></div>
</div>`;

const css = `
:root { color-scheme: light; }
body { margin: 0; font: 13px/1.45 -apple-system, system-ui, sans-serif; color: #1f2430; background: #fff; }
.wrap { padding: 12px; }
.hint { margin: 0 0 8px; color: #6b7280; font-size: 12px; }
textarea { width: 100%; box-sizing: border-box; border: 1px solid #d6dae1; border-radius: 8px; padding: 8px; font: inherit; resize: none; }
.row { display: flex; gap: 6px; margin-top: 8px; }
select { border: 1px solid #d6dae1; border-radius: 8px; padding: 6px 8px; font: inherit; background: #fff; }
button { border: 0; border-radius: 8px; padding: 7px 14px; font: inherit; cursor: pointer; background: #6366F1; color: #fff; }
button:disabled { opacity: .5; cursor: default; }
#go { margin-left: auto; }
.status { font-size: 12px; color: #6b7280; min-height: 16px; margin-top: 8px; }
.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 10px; margin-top: 6px; }
.card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; text-align: center; }
.icon { color: #1f2430; height: 56px; display: flex; align-items: center; justify-content: center; }
.icon svg { width: 48px; height: 48px; }
.dl { margin-top: 8px; background: transparent; color: #6366F1; border: 1px solid #c7cbf5; padding: 4px 8px; font-size: 11px; width: 100%; }`;

// String.raw keeps the SVG-extraction regex intact (a normal template literal
// would eat the backslashes in <\/svg>).
const ui = String.raw`
const $ = (id) => root.querySelector('#' + id);
const STYLES = {
  line: 'minimal single-color line icons, ~1.5px strokes, no fill, rounded joins',
  solid: 'solid filled glyph, single color',
  duotone: 'two-tone (a solid base + a lighter accent of the same hue)',
  flat: 'flat modern icon with simple shapes and a small accent color',
};
const go = $('go');
go.addEventListener('click', async () => {
  const desc = $('desc').value.trim();
  if (!desc) { $('status').textContent = 'Describe an icon first.'; return; }
  const style = STYLES[$('style').value] || $('style').value;
  const n = Number($('count').value) || 1;
  go.disabled = true;
  $('status').textContent = 'Generating ' + n + ' icon' + (n === 1 ? '' : 's') + '…';
  $('gallery').innerHTML = '';
  let made = 0;
  for (let i = 0; i < n; i++) {
    try {
      const prompt =
        'Return ONLY a single inline SVG element (<svg ...>...</svg>), viewBox "0 0 24 24", ' +
        'use currentColor for strokes and fills, no width/height attributes, no XML prolog, ' +
        'no markdown fences, no commentary. Icon: ' + desc + '. Style: ' + style + '. Variation ' + (i + 1) + '.';
      const text = await bridge.gemini(prompt);
      const m = String(text).match(/<svg[^]*?<\/svg>/i);
      if (!m) continue;
      const svg = m[0];
      const card = document.createElement('div');
      card.className = 'card';
      const box = document.createElement('div');
      box.className = 'icon';
      box.innerHTML = svg;
      card.appendChild(box);
      const dl = document.createElement('button');
      dl.className = 'dl';
      dl.type = 'button';
      dl.textContent = 'Download SVG';
      const fname = 'icon-' + (i + 1) + '.svg';
      dl.addEventListener('click', () => api.download(fname, svg, 'image/svg+xml'));
      card.appendChild(dl);
      $('gallery').appendChild(card);
      made++;
      $('status').textContent = 'Generated ' + made + ' of ' + n + '…';
    } catch (e) {
      // skip this variation; keep going
    }
  }
  $('status').textContent = made ? '' : 'No icons returned — try a simpler description.';
  go.disabled = false;
});`;

export const SVG_GENERATOR_APP: AppConfig = {
  id: 'builtin_svggen',
  name: 'SVG Icon Generator',
  description: 'Generate inline SVG icons from a description.',
  inputs: [],
  tier: 3,
  html,
  css,
  ui,
  permissions: ['gemini', 'download'],
  reviewed: true, // built-in, ships with the extension — trusted
  createdAt: 0,
};
