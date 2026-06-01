// Hand-authored Tier-3 marketplace app: BrandSnap AI — a branded-scene composer
// modeled on the MicroLabs original. The key behavior: you UPLOAD a mark, PLACE
// it on the canvas, then the image model GENERATES a scene with the mark
// INTEGRATED into it (printed/embossed/rendered in) — not flatly overlaid. The
// placed mark (composited on a base at your position) is passed as inputImage to
// bridge.image, so the result weaves it into the generated image.
//   1 Canvas (crop ratio) · 2 Style · 3 Palette (editable INPUT) · 4 Scene brief
//   · 5 Mark (upload → place on canvas) → Generate (integrate) → Export.
// cb-* design system only. Permissions: image + download.
import type { AppConfig } from '../types';

const html = `
<div class="cb-app">
  <h1>BrandSnap AI</h1>
  <p class="cb-muted hint">Upload your logo, place it on the canvas, then generate a scene with your mark integrated into the image.</p>

  <div class="step"><span class="num">1</span> Canvas</div>
  <div class="seg" id="ratioSeg" role="group" aria-label="Crop ratio">
    <button type="button" class="seg-btn active" data-r="1:1">1:1</button>
    <button type="button" class="seg-btn" data-r="4:5">4:5</button>
    <button type="button" class="seg-btn" data-r="9:16">9:16</button>
    <button type="button" class="seg-btn" data-r="16:9">16:9</button>
    <button type="button" class="seg-btn" data-r="4:3">4:3</button>
  </div>

  <div class="step"><span class="num">2</span> Style</div>
  <select id="style" class="cb-input"></select>

  <div class="step"><span class="num">3</span> Palette <button id="roll" type="button" class="cb-btn cb-ghost small">↻ Roll</button></div>
  <div id="palette" class="palette"></div>

  <div class="step"><span class="num">4</span> Scene brief</div>
  <textarea id="brief" class="cb-input" rows="2" placeholder="e.g. a matte black coffee mug on a stone ledge"></textarea>

  <div class="step"><span class="num">5</span> Mark — upload &amp; place on the canvas</div>
  <div class="markrow">
    <button id="addLogo" type="button" class="cb-btn cb-ghost">Upload mark</button>
    <span id="markName" class="small cb-muted"></span>
    <button id="logoRemove" type="button" class="cb-btn cb-ghost small" style="display:none">Remove</button>
  </div>
  <input id="logoFile" type="file" accept="image/*" hidden />

  <div id="stage" class="stage" style="display:none">
    <div id="placeLayer" class="placelayer">
      <img id="markImg" class="markimg" alt="mark" />
      <div class="placehint">Drag to place · size below · then Generate</div>
    </div>
    <img id="genImg" class="genimg" alt="result" style="display:none" />
  </div>
  <div id="logoCtl" class="logoctl" style="display:none">
    <label class="lbl" style="margin:0">Mark size</label>
    <input id="logoSize" type="range" min="6" max="60" value="24" />
  </div>

  <button id="go" type="button" class="cb-btn primary">Generate Asset</button>
  <div id="status" class="status cb-muted"></div>

  <div id="actions" class="actions" style="display:none">
    <button id="reposition" type="button" class="cb-btn cb-ghost">Reposition</button>
    <button id="regen" type="button" class="cb-btn cb-ghost">Regenerate</button>
    <button id="dl" type="button" class="cb-btn primary">Export</button>
  </div>
</div>`;

const css = `
.cb-app { font-family: system-ui, sans-serif; color: var(--cb-fg); padding: 12px; }
h1 { font-size: 17px; margin: 0 0 4px; }
.hint { font-size: 12px; margin: 0 0 10px; }
.small { font-weight: 400; font-size: 11px; }
.step { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; color: var(--cb-muted); margin: 14px 0 6px; }
.num { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background: var(--cb-accent); color: #fff; font-size: 11px; }
.lbl { display: block; font-size: 12px; font-weight: 600; color: var(--cb-muted); }
.cb-input { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--cb-border); border-radius: 8px; font: inherit; background: var(--cb-bg); color: var(--cb-fg); resize: vertical; }
.seg { display: flex; gap: 4px; }
.seg-btn { flex: 1; padding: 7px 4px; border: 1px solid var(--cb-border); border-radius: 8px; background: var(--cb-bg); color: var(--cb-fg); font: inherit; font-size: 12px; cursor: pointer; }
.seg-btn.active { background: var(--cb-accent); color: #fff; border-color: var(--cb-accent); }
.cb-btn { margin-top: 12px; padding: 9px 12px; border: 1px solid var(--cb-border); border-radius: 8px; font: inherit; font-weight: 600; cursor: pointer; background: var(--cb-elev); color: var(--cb-fg); }
.cb-btn.primary { width: 100%; background: var(--cb-accent); color: #fff; border-color: var(--cb-accent); }
.cb-btn.cb-ghost { background: transparent; }
.cb-btn.small { margin-top: 0; padding: 4px 8px; font-size: 11px; }
.cb-btn:disabled { opacity: .6; cursor: default; }
.status { font-size: 12px; margin: 8px 0; min-height: 14px; }
.palette { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.sw { width: 30px; height: 30px; border-radius: 7px; border: 1px solid var(--cb-border); cursor: pointer; padding: 0; background: none; overflow: hidden; }
.sw input { width: 140%; height: 140%; margin: -8px; border: 0; padding: 0; background: none; cursor: pointer; }
.markrow { display: flex; align-items: center; gap: 8px; }
.stage { position: relative; margin-top: 12px; border-radius: 12px; overflow: hidden; border: 1px solid var(--cb-border); background: var(--cb-elev); touch-action: none; }
.placelayer { position: absolute; inset: 0; background: repeating-conic-gradient(#e9e9ee 0% 25%, #f6f6f8 0% 50%) 50% / 22px 22px; }
.markimg { position: absolute; transform: translate(-50%, -50%); cursor: move; user-select: none; max-width: none; filter: drop-shadow(0 2px 6px rgba(0,0,0,.25)); }
.placehint { position: absolute; left: 0; right: 0; bottom: 0; padding: 5px 8px; font-size: 10.5px; color: #444; background: rgba(255,255,255,.7); text-align: center; }
.genimg { display: block; width: 100%; height: 100%; object-fit: cover; }
.logoctl { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.logoctl input[type=range] { flex: 1; }
.actions { display: flex; gap: 6px; margin-top: 12px; }
.actions .cb-btn { margin-top: 0; flex: 1; width: auto; }`;

const ui = `
const $ = (id) => root.querySelector('#' + id);
const STYLES = {
  'Product Shot': 'a clean product shot on a seamless studio background, soft shadows, crisp',
  'Lifestyle': 'a natural lifestyle photograph in a real environment, soft daylight',
  'Luxury': 'a luxury editorial scene, refined materials, elegant directional light',
  'Studio': 'a professional studio setup, controlled lighting, premium',
  'Minimal': 'a minimal flat-lay with generous negative space, pastel ground',
  'Neon Night': 'a vibrant neon-lit night scene, glossy reflections, dramatic color',
  'Nature': 'an organic natural setting with foliage and warm sunlight',
  'Tech/Modern': 'a sleek modern tech aesthetic, clean lines, cool tones',
  'Cyberpunk': 'a cyberpunk scene, saturated neon, futuristic grit',
  'Gradient': 'a smooth studio gradient backdrop, soft glow'
};
const styleSel = $('style');
Object.keys(STYLES).forEach(function (k) { const o = document.createElement('option'); o.value = k; o.textContent = k; styleSel.appendChild(o); });

// --- Canvas crop ratio (segmented) ---
let ratio = '1:1';
const ratioSeg = $('ratioSeg');
ratioSeg.querySelectorAll('.seg-btn').forEach(function (b) {
  b.addEventListener('click', function () {
    ratioSeg.querySelectorAll('.seg-btn').forEach(function (x) { x.classList.remove('active'); });
    b.classList.add('active'); ratio = b.getAttribute('data-r'); applyStageRatio();
  });
});
function ratioWH() { const p = ratio.split(':'); return { w: Number(p[0]) || 1, h: Number(p[1]) || 1 }; }
function applyStageRatio() { const r = ratioWH(); $('stage').style.aspectRatio = r.w + ' / ' + r.h; }

// --- Palette (rolled + editable INPUT) ---
let palette = [];
function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return '#' + [r, g, b].map(function (v) { return Math.round((v + m) * 255).toString(16).padStart(2, '0'); }).join('');
}
function roll() {
  const base = Math.floor(Math.random() * 360);
  palette = [hsl(base, 65, 55), hsl(base + 25, 60, 45), hsl(base + 180, 55, 60), hsl(base + 200, 40, 35), hsl(base, 20, 90)];
  renderPalette();
}
function renderPalette() {
  const p = $('palette'); p.innerHTML = '';
  palette.forEach(function (c, i) {
    const sw = document.createElement('span'); sw.className = 'sw';
    const inp = document.createElement('input'); inp.type = 'color'; inp.value = c; inp.title = c;
    inp.addEventListener('input', function () { palette[i] = inp.value; });
    sw.appendChild(inp); p.appendChild(sw);
  });
}
$('roll').addEventListener('click', roll);

// --- Mark: upload + place on the canvas (becomes the inputImage to integrate) ---
const markImg = $('markImg'); const placeLayer = $('placeLayer'); const genImg = $('genImg'); const stage = $('stage'); const status = $('status');
let markPos = { x: 0.5, y: 0.5, w: 0.28 };
function applyMark() {
  if (!markImg.getAttribute('src')) return;
  markImg.style.left = (markPos.x * 100) + '%'; markImg.style.top = (markPos.y * 100) + '%'; markImg.style.width = (markPos.w * 100) + '%';
}
function showPlace() {
  stage.style.display = 'block'; placeLayer.style.display = 'block'; genImg.style.display = 'none';
  $('logoCtl').style.display = markImg.getAttribute('src') ? 'flex' : 'none';
  applyStageRatio(); applyMark();
}
$('addLogo').addEventListener('click', function () { $('logoFile').click(); });
$('logoFile').addEventListener('change', function () {
  const f = $('logoFile').files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = function () { markImg.src = r.result; markPos = { x: 0.5, y: 0.5, w: 0.28 }; $('markName').textContent = f.name; $('logoRemove').style.display = 'inline-block'; $('logoSize').value = '24'; showPlace(); };
  r.readAsDataURL(f);
});
$('logoRemove').addEventListener('click', function () {
  markImg.removeAttribute('src'); $('markName').textContent = ''; $('logoRemove').style.display = 'none'; $('logoCtl').style.display = 'none';
  if (genImg.style.display === 'none') stage.style.display = 'none';
});
$('logoSize').addEventListener('input', function () { markPos.w = Number($('logoSize').value) / 100; applyMark(); });

// drag the mark within the placement canvas
let dragging = false;
function frac(e) { const r = stage.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; }
markImg.addEventListener('pointerdown', function (e) { if (!markImg.getAttribute('src')) return; dragging = true; if (markImg.setPointerCapture) markImg.setPointerCapture(e.pointerId); e.preventDefault(); });
markImg.addEventListener('pointermove', function (e) { if (!dragging) return; const p = frac(e); markPos.x = p.x; markPos.y = p.y; applyMark(); });
markImg.addEventListener('pointerup', function () { dragging = false; });

// Composite the PLACED mark onto a base canvas → the inputImage the model integrates.
function buildInput() {
  const r = ratioWH(); const W = 1024, H = Math.round(W * r.h / r.w);
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  x.fillStyle = '#efefef'; x.fillRect(0, 0, W, H);
  if (markImg.getAttribute('src')) {
    const lw = markPos.w * W; const lh = lw * (markImg.naturalHeight / markImg.naturalWidth);
    x.drawImage(markImg, markPos.x * W - lw / 2, markPos.y * H - lh / 2, lw, lh);
  }
  return c.toDataURL('image/png');
}

// --- Generate: the mark is INTEGRATED by the image model, not overlaid ---
async function generate() {
  const brief = $('brief').value.trim();
  const pal = palette.length ? ' Use this color palette prominently: ' + palette.join(', ') + '.' : '';
  const hasMark = !!markImg.getAttribute('src');
  const go = $('go'); go.disabled = true; status.textContent = hasMark ? 'Generating — integrating your mark…' : 'Generating…';
  try {
    let opts;
    if (hasMark) {
      const prompt = 'You are given an image with a logo/brand mark on a plain background. Generate a professional ' + STYLES[styleSel.value] + ' product/brand scene that INTEGRATES that mark naturally into the image — render it as if it is physically printed, embossed, engraved, or displayed on a real surface or product, keeping it legible and roughly in the same position. Build a cohesive scene around it. Scene: ' + (brief || 'a premium product presentation') + '.' + pal + ' ' + ratio + ' composition, photorealistic, high quality, no extra text, no watermark.';
      opts = { prompt: prompt, inputImage: buildInput(), aspect: ratio };
    } else {
      const prompt = 'Create a professional ' + STYLES[styleSel.value] + ' product/brand scene. Scene: ' + (brief || 'an elegant product on a clean surface') + '.' + pal + ' ' + ratio + ' composition, high quality, sharp, no text, no watermark.';
      opts = { prompt: prompt, aspect: ratio };
    }
    const out = await bridge.image(opts);
    genImg.src = out; applyStageRatio();
    stage.style.display = 'block'; placeLayer.style.display = 'none'; genImg.style.display = 'block';
    $('logoCtl').style.display = 'none'; $('actions').style.display = 'flex';
    $('reposition').style.display = hasMark ? 'block' : 'none';
    status.textContent = '';
  } catch (e) { status.textContent = 'Error: ' + ((e && e.message) || 'generation failed'); }
  go.disabled = false;
}
$('go').addEventListener('click', generate);
$('regen').addEventListener('click', generate);
$('reposition').addEventListener('click', showPlace);
$('dl').addEventListener('click', function () { if (genImg.getAttribute('src')) api.download('brand-asset.png', genImg.src); });

// init
roll(); applyStageRatio();`;

export const BRANDSNAP_APP: AppConfig = {
  id: 'brandsnap-ai',
  name: 'BrandSnap AI',
  description: 'Upload your logo, place it on the canvas, and the AI generates a styled product scene with your mark integrated into the image — then export.',
  inputs: [],
  tier: 3,
  html,
  css,
  ui,
  permissions: ['image', 'download'],
  reviewed: false,
  createdAt: 0,
};
