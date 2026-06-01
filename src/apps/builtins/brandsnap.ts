// Hand-authored Tier-3 marketplace app: BrandSnap AI.
//
// A brand-asset studio: describe a product → pick a style + format → generate
// (bridge.image) → auto-extract a color palette from the result (client-side
// canvas, no LLM) → optionally drop your logo on top and drag to position →
// export the composite (api.download). Uses ONLY the cb-* design system so it
// looks native in the side panel. Permissions: image + download (no gemini,
// no page — minimal).
import type { AppConfig } from '../types';

const html = `
<div class="cb-app">
  <h1>BrandSnap AI</h1>
  <p class="cb-muted hint">Generate a styled brand/product image, pull its palette, drop your logo on top, and export.</p>
  <label class="lbl">What to shoot</label>
  <input id="desc" class="cb-input" placeholder="e.g. a matte black coffee mug" />
  <div class="grid2">
    <div><label class="lbl">Style</label><select id="style" class="cb-input"></select></div>
    <div><label class="lbl">Format</label><select id="format" class="cb-input"></select></div>
  </div>
  <button id="go" class="cb-btn primary" type="button">Generate</button>
  <div id="status" class="status cb-muted"></div>
  <div id="stage" class="stage" style="display:none">
    <img id="genImg" class="genimg" alt="generated" />
    <img id="logoImg" class="logoimg" alt="logo" style="display:none" />
  </div>
  <div id="paletteWrap" class="palettewrap" style="display:none">
    <label class="lbl">Palette <span class="small cb-muted">(click a swatch to copy)</span></label>
    <div id="palette" class="palette"></div>
  </div>
  <div id="logoCtl" class="logoctl" style="display:none">
    <label class="lbl" style="margin:0">Logo size</label>
    <input id="logoSize" type="range" min="8" max="50" value="22" />
    <button id="logoRemove" class="cb-btn cb-ghost small" type="button">Remove</button>
  </div>
  <div id="actions" class="actions" style="display:none">
    <button id="addLogo" class="cb-btn cb-ghost" type="button">Add logo</button>
    <button id="regen" class="cb-btn cb-ghost" type="button">Regenerate</button>
    <button id="dl" class="cb-btn primary" type="button">Download</button>
  </div>
  <input id="logoFile" type="file" accept="image/*" hidden />
</div>`;

const css = `
.cb-app { font-family: system-ui, sans-serif; color: var(--cb-fg); padding: 12px; }
h1 { font-size: 17px; margin: 0 0 4px; }
.hint { font-size: 12px; margin: 0 0 12px; }
.lbl { display: block; font-size: 12px; font-weight: 600; margin: 10px 0 4px; color: var(--cb-muted); }
.small { font-weight: 400; font-size: 11px; }
.cb-input { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--cb-border); border-radius: 8px; font: inherit; background: var(--cb-bg); color: var(--cb-fg); }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.cb-btn { margin-top: 12px; padding: 9px 12px; border: 1px solid var(--cb-border); border-radius: 8px; font: inherit; font-weight: 600; cursor: pointer; background: var(--cb-elev); color: var(--cb-fg); }
.cb-btn.primary { width: 100%; background: var(--cb-accent); color: #fff; border-color: var(--cb-accent); }
.cb-btn.cb-ghost { background: transparent; }
.cb-btn.small { margin-top: 0; padding: 5px 8px; font-size: 11px; }
.cb-btn:disabled { opacity: .6; cursor: default; }
.status { font-size: 12px; margin: 8px 0; min-height: 14px; }
.stage { position: relative; margin-top: 10px; border-radius: 12px; overflow: hidden; border: 1px solid var(--cb-border); background: var(--cb-elev); touch-action: none; }
.genimg { display: block; width: 100%; }
.logoimg { position: absolute; transform: translate(-50%, -50%); cursor: move; user-select: none; filter: drop-shadow(0 2px 6px rgba(0,0,0,.35)); }
.palettewrap { margin-top: 10px; }
.palette { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.sw { width: 26px; height: 26px; border-radius: 6px; border: 1px solid var(--cb-border); cursor: pointer; padding: 0; }
.sw.copied { outline: 2px solid var(--cb-accent); outline-offset: 1px; }
.swlab { font-family: ui-monospace, monospace; font-size: 10px; color: var(--cb-muted); margin-right: 6px; }
.logoctl { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.logoctl input[type=range] { flex: 1; }
.actions { display: flex; gap: 6px; margin-top: 12px; }
.actions .cb-btn { margin-top: 0; flex: 1; width: auto; }`;

const ui = `
const $ = (id) => root.querySelector('#' + id);
const STYLES = {
  'Lifestyle': 'a natural lifestyle product photograph in a real environment, soft natural light',
  'Studio': 'a clean studio product shot on a seamless background, soft shadows, crisp and sharp',
  'Marble': 'set on elegant carved marble, luxury feel, soft directional light',
  'Brushed metal': 'on a brushed-metal / chrome surface, premium industrial look, subtle reflections',
  'Minimal flat-lay': 'a minimal flat-lay with lots of negative space, pastel background, editorial',
  'Neon': 'a vibrant neon-lit scene, glossy, energetic dramatic color',
  'Street art': 'a bold street-art / graffiti backdrop, urban and colorful',
  'Nature': 'an organic natural setting with foliage, warm sunlight, earthy tones'
};
const FORMATS = {
  'Square': '1:1 square composition, subject centered',
  'Portrait': '4:5 vertical composition',
  'Story': '9:16 tall vertical composition',
  'Landscape': '16:9 wide horizontal composition'
};
const styleSel = $('style'); Object.keys(STYLES).forEach(function (k) { const o = document.createElement('option'); o.value = k; o.textContent = k; styleSel.appendChild(o); });
const fmtSel = $('format'); Object.keys(FORMATS).forEach(function (k) { const o = document.createElement('option'); o.value = k; o.textContent = k; fmtSel.appendChild(o); });

const genImg = $('genImg'); const logoImg = $('logoImg'); const stage = $('stage'); const status = $('status');
let logoPos = { x: 0.5, y: 0.8, w: 0.22 };

function applyLogo() {
  if (!logoImg.getAttribute('src')) { logoImg.style.display = 'none'; return; }
  logoImg.style.display = 'block';
  logoImg.style.left = (logoPos.x * 100) + '%';
  logoImg.style.top = (logoPos.y * 100) + '%';
  logoImg.style.width = (logoPos.w * 100) + '%';
}

function renderPalette(hex) {
  const p = $('palette'); p.innerHTML = '';
  hex.forEach(function (c) {
    const sw = document.createElement('button'); sw.type = 'button'; sw.className = 'sw'; sw.style.background = c; sw.title = c + ' — click to copy';
    sw.addEventListener('click', function () { try { navigator.clipboard.writeText(c); } catch (e) {} sw.classList.add('copied'); setTimeout(function () { sw.classList.remove('copied'); }, 700); });
    p.appendChild(sw);
    const lab = document.createElement('span'); lab.className = 'swlab'; lab.textContent = c; p.appendChild(lab);
  });
  $('paletteWrap').style.display = hex.length ? 'block' : 'none';
}

function extractPalette() {
  try {
    const w = 48, h = Math.max(8, Math.round(48 * (genImg.naturalHeight / genImg.naturalWidth)) || 48);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.drawImage(genImg, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data; const b = {};
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
      if (!b[k]) b[k] = { c: 0, r: 0, g: 0, bl: 0 };
      const o = b[k]; o.c++; o.r += d[i]; o.g += d[i + 1]; o.bl += d[i + 2];
    }
    const keys = Object.keys(b).map(function (k) { return b[k]; }).sort(function (a, z) { return z.c - a.c; }).slice(0, 5);
    const hex = keys.map(function (o) { return '#' + [Math.round(o.r / o.c), Math.round(o.g / o.c), Math.round(o.bl / o.c)].map(function (v) { return v.toString(16).padStart(2, '0'); }).join(''); });
    renderPalette(hex);
  } catch (e) {}
}

async function generate() {
  const desc = $('desc').value.trim();
  const style = STYLES[styleSel.value]; const fmt = FORMATS[fmtSel.value];
  const go = $('go'); go.disabled = true; status.textContent = 'Generating…';
  try {
    const prompt = 'Create a professional brand/product image. Subject: ' + (desc || 'an elegant product') + '. Style: ' + style + '. Composition: ' + fmt + '. High quality, sharp, well-lit, no text, no watermark.';
    const out = await bridge.image({ prompt: prompt, aspect: fmtSel.value.toLowerCase() });
    genImg.onload = function () { extractPalette(); };
    genImg.src = out;
    stage.style.display = 'block'; $('actions').style.display = 'flex'; status.textContent = '';
  } catch (e) { status.textContent = 'Error: ' + ((e && e.message) || 'generation failed'); }
  go.disabled = false;
}
$('go').addEventListener('click', generate);
$('regen').addEventListener('click', generate);

$('addLogo').addEventListener('click', function () { $('logoFile').click(); });
$('logoFile').addEventListener('change', function () {
  const f = $('logoFile').files[0]; if (!f) return;
  const r = new FileReader(); r.onload = function () { logoImg.src = r.result; logoPos = { x: 0.5, y: 0.8, w: 0.22 }; applyLogo(); $('logoCtl').style.display = 'flex'; $('logoSize').value = '22'; }; r.readAsDataURL(f);
});
$('logoSize').addEventListener('input', function () { logoPos.w = Number($('logoSize').value) / 100; applyLogo(); });
$('logoRemove').addEventListener('click', function () { logoImg.removeAttribute('src'); logoImg.style.display = 'none'; $('logoCtl').style.display = 'none'; });

let dragging = false;
function frac(e) { const r = stage.getBoundingClientRect(); const cx = e.clientX, cy = e.clientY; return { x: Math.min(1, Math.max(0, (cx - r.left) / r.width)), y: Math.min(1, Math.max(0, (cy - r.top) / r.height)) }; }
logoImg.addEventListener('pointerdown', function (e) { if (!logoImg.getAttribute('src')) return; dragging = true; if (logoImg.setPointerCapture) logoImg.setPointerCapture(e.pointerId); e.preventDefault(); });
logoImg.addEventListener('pointermove', function (e) { if (!dragging) return; const p = frac(e); logoPos.x = p.x; logoPos.y = p.y; applyLogo(); });
logoImg.addEventListener('pointerup', function () { dragging = false; });

$('dl').addEventListener('click', function () {
  if (!genImg.getAttribute('src')) return;
  const c = document.createElement('canvas'); c.width = genImg.naturalWidth || 1024; c.height = genImg.naturalHeight || 1024;
  const x = c.getContext('2d'); x.drawImage(genImg, 0, 0, c.width, c.height);
  if (logoImg.getAttribute('src')) {
    const lw = logoPos.w * c.width; const lh = lw * (logoImg.naturalHeight / logoImg.naturalWidth);
    x.drawImage(logoImg, logoPos.x * c.width - lw / 2, logoPos.y * c.height - lh / 2, lw, lh);
  }
  try { api.download('brand-asset.png', c.toDataURL('image/png')); } catch (e) { api.download('brand-asset.png', genImg.src); }
});`;

export const BRANDSNAP_APP: AppConfig = {
  id: 'brandsnap-ai',
  name: 'BrandSnap AI',
  description: 'Generate a styled brand/product image, auto-extract its color palette, overlay your logo, and export.',
  inputs: [],
  tier: 3,
  html,
  css,
  ui,
  permissions: ['image', 'download'],
  reviewed: false,
  createdAt: 0,
};
