// Built-in Tier-3 sandbox-UI app: SVG Icon & Logo Generator.
//
// Quality pipeline (matches the MicroLabs original): generate a high-contrast
// raster icon with the IMAGE model (bridge.image) → vector-TRACE it to a clean,
// cropped SVG (bridge.trace, host-side ImageTracer). This produces far richer
// icons than asking a text model to author SVG paths. 65 styles, icon + logo
// modes, a history gallery, and SVG/PNG copy + download.
import type { AppConfig } from '../types';

const html = `
<div class="cb-app">
  <div class="hd">
    <div>
      <h1>SVG Generator</h1>
      <p class="cb-muted hint">Image-generated, then vector-traced — crisp, scalable icons & logos.</p>
    </div>
    <span id="count" class="cb-muted small"></span>
  </div>

  <div class="seg" id="modeSeg" role="group" aria-label="Mode">
    <button type="button" class="seg-btn active" data-m="icon">Icon</button>
    <button type="button" class="seg-btn" data-m="logo">Logo</button>
  </div>

  <div id="logoTypes" class="ltypes" style="display:none">
    <button type="button" class="lt active" data-lt="icon_only"><b>Symbol</b><span>Graphic</span></button>
    <button type="button" class="lt" data-lt="wordmark"><b>Wordmark</b><span>Text</span></button>
    <button type="button" class="lt" data-lt="monogram"><b>Monogram</b><span>Initials</span></button>
    <button type="button" class="lt" data-lt="combination"><b>Combo</b><span>Icon+Text</span></button>
  </div>

  <label class="lbl">Visual style</label>
  <select id="style" class="cb-input"></select>

  <input id="name" class="cb-input" type="text" placeholder="Icon subject (e.g. Rocket)" />
  <textarea id="desc" class="cb-input" rows="2" placeholder="Additional details (optional)"></textarea>

  <button id="go" type="button" class="cb-btn primary">✨ Generate</button>
  <div id="status" class="status cb-muted"></div>
  <div id="err" class="err" style="display:none"></div>

  <div id="gallery" class="gallery"></div>
  <div id="empty" class="empty">No icons yet — describe one above and generate.</div>
</div>`;

const css = `
.cb-app { font-family: system-ui, sans-serif; color: var(--cb-fg); padding: 12px; }
.hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
h1 { font-size: 16px; margin: 0; }
.hint { font-size: 11.5px; margin: 2px 0 10px; }
.small { font-size: 11px; }
.seg { display: flex; gap: 4px; margin-bottom: 8px; }
.seg-btn { flex: 1; padding: 7px; border: 1px solid var(--cb-border); border-radius: 8px; background: var(--cb-bg); color: var(--cb-fg); font: inherit; font-size: 12px; cursor: pointer; }
.seg-btn.active { background: var(--cb-accent); color: #fff; border-color: var(--cb-accent); }
.ltypes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-bottom: 8px; }
.lt { padding: 6px 2px; border: 1px solid var(--cb-border); border-radius: 8px; background: var(--cb-bg); color: var(--cb-fg); cursor: pointer; display: flex; flex-direction: column; gap: 1px; align-items: center; }
.lt.active { border-color: var(--cb-accent); background: color-mix(in srgb, var(--cb-accent) 14%, transparent); }
.lt b { font-size: 10.5px; } .lt span { font-size: 8.5px; color: var(--cb-muted); }
.lbl { display: block; font-size: 11px; font-weight: 600; color: var(--cb-muted); margin: 6px 0 3px; }
.cb-input { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--cb-border); border-radius: 8px; font: inherit; background: var(--cb-bg); color: var(--cb-fg); margin-bottom: 7px; resize: vertical; }
.cb-btn { padding: 9px 12px; border: 1px solid var(--cb-border); border-radius: 8px; font: inherit; font-weight: 600; cursor: pointer; background: var(--cb-elev); color: var(--cb-fg); }
.cb-btn.primary { width: 100%; background: var(--cb-accent); color: #fff; border-color: var(--cb-accent); }
.cb-btn:disabled { opacity: .6; cursor: default; }
.status { font-size: 12px; min-height: 14px; margin: 6px 0; }
.err { font-size: 12px; color: #B91C1C; background: color-mix(in srgb, #EF4444 10%, transparent); border-radius: 8px; padding: 7px 10px; margin: 4px 0; }
.gallery { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 6px; }
.card { border: 1px solid var(--cb-border); border-radius: 10px; overflow: hidden; background: var(--cb-bg); }
.card-prev { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; padding: 14px; background: var(--cb-elev); position: relative; }
.card-prev svg { width: 100%; height: 100%; color: var(--cb-fg); }
.card-del { position: absolute; top: 4px; right: 4px; border: 0; background: rgba(0,0,0,.5); color: #fff; border-radius: 50%; width: 18px; height: 18px; line-height: 1; cursor: pointer; font-size: 11px; }
.card-info { padding: 7px; }
.card-name { font-size: 11.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card-style { font-size: 9px; text-transform: uppercase; letter-spacing: .04em; color: var(--cb-muted); margin-bottom: 5px; }
.card-acts { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 3px; }
.card-acts button { font: inherit; font-size: 9.5px; padding: 4px 2px; border: 1px solid var(--cb-border); border-radius: 5px; background: transparent; color: var(--cb-muted); cursor: pointer; }
.card-acts button:hover { color: var(--cb-fg); }
.empty { text-align: center; color: var(--cb-muted); font-size: 12px; padding: 24px 8px; }`;

// The app logic. String.raw so the SVG-extraction backslashes survive. Runs as
// (root, bridge, api) => { ... } inside the sandbox.
const ui = String.raw`
const $ = (id) => root.querySelector('#' + id);
const STYLE_GROUPS = {
  'Essentials': [['lucid','Lucid (Default)']],
  'Logo & Professional': [['logo_mark','Logo Mark'],['mascot','Esports Mascot'],['monogram','Luxury Monogram'],['material','Material Design'],['fluent','Fluent Design'],['corporate','Corporate Minimal'],['startup','Tech Startup'],['flat_25d','Flat 2.5D'],['duotone','Duotone Split'],['badge','Outlined Badge']],
  'Technical': [['blueprint','Blueprint / Schematic'],['architectural','Architectural Sketch'],['circuit','Circuit Board (PCB)'],['neon','Neon Sign']],
  'Fun & Comic': [['kawaii','Kawaii (Cute)'],['classic_animation','Classic Animation'],['rubber_hose','Vintage 1930s'],['tv_cartoon','TV Cartoon'],['superhero','Superhero Comic'],['graffiti','Graffiti / Street'],['sticker','Sticker Art'],['retro_anime','Retro Anime (90s)'],['comic','Comic Book'],['pop_art','Pop Art']],
  'Craft & Texture': [['paper_cutout','Paper Cutout'],['embroidery','Embroidery / Stitch']],
  '3D': [['photorealistic','Photorealistic 3D'],['photorealistic_angled','Photorealistic 3D (Angled)'],['isometric_3d','Isometric 3D'],['isometric_rounded','Rounded Isometric'],['clay_3d','Smooth Clay 3D'],['low_poly','Low Poly 3D'],['glossy_3d','Glossy Plastic 3D'],['metallic_3d','Metallic 3D'],['glass_3d','Glass 3D'],['voxel_3d','Voxel Cubic 3D'],['balloon_3d','Inflated Balloon 3D'],['liquid_3d','Melting Liquid 3D']],
  'Hand-drawn': [['sketch','Sketch (Hand-Drawn)'],['crayon','Kids Crayon'],['doodle','Doodle'],['chalk','Chalk Texture'],['marker','Marker Drawing']],
  'Abstract': [['geometric','Geometric Abstract'],['fluid','Fluid Organic'],['glitch','Glitch Art'],['single_line','Single Line'],['splatter','Splatter Paint'],['negative_space','Negative Space']],
  'Art Movements': [['bauhaus','Bauhaus'],['swiss','Swiss International'],['art_deco','Art Deco'],['brutalist','Brutalist'],['mid_century','Mid-Century Modern'],['japanese','Japanese Minimalist'],['art_nouveau','Art Nouveau'],['de_stijl','De Stijl'],['tribal','Tribal / Aztec'],['origami','Origami / Folded'],['stencil','Industrial Stencil'],['victorian','Victorian / Woodcut']],
  'Thematic': [['cyberpunk','Cyberpunk'],['pixel','Pixel Art (8-Bit)'],['steampunk','Steampunk'],['gothic','Gothic']],
};
const SP = {
  lucid:'Minimalist Lucid icon. Uniform line thickness, rounded caps, open shapes. Clean, friendly.',
  logo_mark:'Logo Mark. Bold, memorable, reductive. Solid fills, high contrast. Iconic, corporate.',
  mascot:'Esports Mascot. Aggressive dynamic character. Thick bold contours, angular shading.',
  monogram:'Luxury Monogram. Interwoven lines, letter-like abstraction, symmetry. Sophisticated.',
  material:'Material Design. Flat layers, paper physics, solid black shadows, geometric forms.',
  fluent:'Fluent Design. Weightless, light, depth. Clean lines, perspective hints. Modern UI.',
  corporate:'Corporate Minimal. Grid-based, ultra-clean, thin uniform lines, perfect geometry.',
  startup:'Tech Startup. Friendly geometry, slightly rounded, bold strokes, simple composition.',
  flat_25d:'Flat 2.5D. Isometric perspective, flat colors, distinct planes. Informative, clean.',
  duotone:'Duotone Split. Sharp division light vs shadow, half outlined half solid. Stylish.',
  badge:'Outlined Badge. Enclosed in a circle/shield, uniform stroke. Official, verified.',
  blueprint:'Technical Blueprint. Engineering diagram, thin precise lines, dashed construction lines.',
  architectural:'Architectural Sketch. Draftsman concept, loose straight lines, corner overshoots.',
  circuit:'PCB Circuit. Tech nodes, traces, lines ending in dots, 45-degree turns. Electronic.',
  neon:'Neon Sign. Glowing glass tubes, double parallel outlines, rounded ends. Retro-tech.',
  kawaii:'Kawaii cute. Exaggerated rounded proportions, big heads, soft lines, minimal detail.',
  classic_animation:'Classic Animation. Smooth flowing line art, elegant tapered ink lines.',
  rubber_hose:'Vintage 1930s cartoon. Pie-cut eyes, noodle limbs, uniform thick black lines.',
  tv_cartoon:'Prime-time TV animation. Large circular eyes with pupil dots, bold uniform outlines, flat black/white.',
  superhero:'Superhero Comic. Dynamic action, heavy spot-black shadows, varying line weights.',
  graffiti:'Graffiti. Bubble-letter style, drips, ultra thick outlines. Urban, rebellious.',
  sticker:'Die-cut sticker with a very thick bold outer contour. Collectible, pop.',
  retro_anime:'90s retro anime. Cel-shaded, dramatic lighting, sharp angular shadow blocks.',
  comic:'Comic Book. Dynamic, bold, heavy outlines, Kirby dots. Action.',
  pop_art:'Pop Art. High contrast, explosive shapes, very thick outlines. Loud.',
  paper_cutout:'Paper Cutout. Layered paper, shapes defined by sharp drop shadows. Tactile.',
  embroidery:'Embroidery. Thread texture, lines made of small stitches. Handmade.',
  photorealistic:'Photorealistic Engraving. Woodcut-style hatching for shading, no gradients. Premium.',
  photorealistic_angled:'Photorealistic Angled 3/4 view. Woodcut hatching for depth, deep contrast.',
  isometric_3d:'Isometric line art, 30-degree angles, dimensional structures, uniform line weight.',
  isometric_rounded:'Rounded Isometric (45 degrees), smoothed edges, clean lines, friendly geometry.',
  clay_3d:'Smooth Clay 3D. Soft rounded organic forms, thick soft outlines, blob shadows.',
  low_poly:'Low Poly wireframe. Faceted triangles, black outlines per polygon edge, no fills.',
  glossy_3d:'Glossy Plastic. Shiny surfaces, black with sharp white reflection shapes. Toy-like.',
  metallic_3d:'Metallic chrome. High-contrast horizon lines, bands of black and white reflection.',
  glass_3d:'Glass / Transparent. Thin outlines, refraction lines, overlap indicators. Futuristic.',
  voxel_3d:'Voxel cubic. Stacked 3D cubes, thick black outlines per cube, distinct separation.',
  balloon_3d:'Inflated Balloon. Puffy tight seams, round forms with pinch points, white highlights.',
  liquid_3d:'Melting Liquid. Dripping viscous fluid, smooth curves, teardrops, connecting blobs.',
  sketch:'Hand-Drawn Sketch. Imperfect variable-width slightly wobbly lines. Casual.',
  crayon:'Kids Crayon. Rough waxy texture, broken edges, uneven pressure. Playful.',
  doodle:'Notebook Doodle. Casual loopy ballpoint, thin multi-pass strokes. Informal.',
  chalk:'Chalk. Dusty grainy edges, stipple texture, black on white. Rustic.',
  marker:'Permanent Marker. Thick bold constant-width lines, slight bleed. Loud.',
  geometric:'Geometric Abstract. Primitives (circles/triangles/squares), clean mathematical lines.',
  fluid:'Fluid Organic. Amoeba-like shapes, no straight lines, smooth flowing curves.',
  glitch:'Glitch Art. Digital corruption, horizontal slicing, pixel displacement. Edgy.',
  single_line:'Minimalist single continuous line drawing, one unbroken stroke. Elegant.',
  splatter:'Splatter Paint. Chaotic splashes, shape from negative space. Expressive.',
  negative_space:'Negative Space. Subject defined by what is NOT drawn, solid block with white cutout.',
  bauhaus:'Bauhaus. Geometric primitives, asymmetrical, mix of heavy blocks and fine lines.',
  swiss:'Swiss International. Grid-based mathematical, very heavy bold strokes.',
  art_deco:'Art Deco. Sunbursts, parallel lines, elegant curves. Luxury.',
  brutalist:'Brutalist. Raw blocky exaggerated, thick jagged lines. Aggressive.',
  mid_century:'Mid-Century Modern. Organic kidney shapes, starbursts, rhythmic lines.',
  japanese:'Japanese Minimalist. Zen simplicity, brush strokes or crest design.',
  art_nouveau:'Art Nouveau. Flowing organic lines, plant forms, sinuous varying thickness.',
  de_stijl:'De Stijl. Horizontal/vertical lines only, thick black grids. Order.',
  tribal:'Tribal / Aztec. Indigenous patterns, bold angular lines.',
  origami:'Origami / Folded. Faceted planes, creases, angular straight lines. Precise.',
  stencil:'Industrial Stencil. Bridges, broken lines, thick segments. Urban.',
  victorian:'Victorian / Woodcut. Intricate fine engraved look, hatching lines. Vintage.',
  cyberpunk:'Cyberpunk. Circuitry, glitches, angular cuts. High-tech.',
  pixel:'Pixel Art 8-bit. Low-res stepped edges, blocky squares. Retro.',
  steampunk:'Steampunk. Gears, brass aesthetics, detailed ornamental lines.',
  gothic:'Gothic. Sharp arches, spikes, angular vertical stress. Dark.',
};
const LT = { icon_only:'A pictorial symbol or abstract mark. NO text.', monogram:'A monogram using the initials, intertwined letters.', wordmark:'A wordmark: the brand name in custom typography.', combination:'A combination mark: a symbol plus the brand name.' };

// Build the grouped style dropdown.
const styleSel = $('style');
Object.keys(STYLE_GROUPS).forEach(function (g) {
  const og = document.createElement('optgroup'); og.label = g;
  STYLE_GROUPS[g].forEach(function (pair) { const o = document.createElement('option'); o.value = pair[0]; o.textContent = pair[1]; og.appendChild(o); });
  styleSel.appendChild(og);
});

let mode = 'icon';
let logoType = 'icon_only';
const history = [];

const modeSeg = $('modeSeg');
modeSeg.querySelectorAll('.seg-btn').forEach(function (b) {
  b.addEventListener('click', function () {
    mode = b.getAttribute('data-m');
    modeSeg.querySelectorAll('.seg-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
    $('logoTypes').style.display = mode === 'logo' ? 'grid' : 'none';
    $('name').placeholder = mode === 'logo' ? 'Brand name (e.g. Acme)' : 'Icon subject (e.g. Rocket)';
    $('desc').placeholder = mode === 'logo' ? 'Brand context (industry, values)…' : 'Additional details (optional)';
    $('go').textContent = mode === 'logo' ? '✨ Generate Logo' : '✨ Generate';
  });
});
$('logoTypes').querySelectorAll('.lt').forEach(function (b) {
  b.addEventListener('click', function () {
    logoType = b.getAttribute('data-lt');
    $('logoTypes').querySelectorAll('.lt').forEach(function (x) { x.classList.toggle('active', x === b); });
  });
});

function refreshCount() { $('count').textContent = history.length ? history.length + ' generated' : ''; $('empty').style.display = history.length ? 'none' : 'block'; }

function copyText(t) { try { const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); } catch (e) {} }
function blackify(svg) { return svg.replace(/currentColor/g, 'black'); }
function slug(s) { return (s || 'icon').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'icon'; }

function renderCard(item) {
  const card = document.createElement('div'); card.className = 'card';
  const prev = document.createElement('div'); prev.className = 'card-prev'; prev.innerHTML = item.svg;
  const del = document.createElement('button'); del.className = 'card-del'; del.type = 'button'; del.textContent = '×';
  del.addEventListener('click', function () { const i = history.indexOf(item); if (i >= 0) history.splice(i, 1); card.remove(); refreshCount(); });
  prev.appendChild(del);
  const info = document.createElement('div'); info.className = 'card-info';
  info.innerHTML = '<div class="card-name"></div><div class="card-style"></div>';
  info.querySelector('.card-name').textContent = item.name;
  info.querySelector('.card-style').textContent = item.style;
  const acts = document.createElement('div'); acts.className = 'card-acts';
  const mkBtn = function (label, fn) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', fn); return b; };
  acts.appendChild(mkBtn('Copy', function (e) { copyText(blackify(item.svg)); const t = e.target; const o = t.textContent; t.textContent = '✓'; setTimeout(function () { t.textContent = o; }, 1200); }));
  acts.appendChild(mkBtn('SVG', function () { api.download(slug(item.name) + '.svg', blackify(item.svg), 'image/svg+xml'); }));
  acts.appendChild(mkBtn('PNG', function () { api.download(slug(item.name) + '.png', item.raster, 'image/png'); }));
  info.appendChild(acts); card.appendChild(prev); card.appendChild(info);
  $('gallery').insertBefore(card, $('gallery').firstChild);
}

$('go').addEventListener('click', async function () {
  const name = $('name').value.trim();
  if (!name) { $('status').textContent = 'Describe an icon first.'; return; }
  const desc = $('desc').value.trim();
  const styleVal = styleSel.value; const styleInstr = SP[styleVal] || SP.lucid;
  const go = $('go'); go.disabled = true; $('err').style.display = 'none';
  try {
    let prompt;
    if (mode === 'logo') {
      prompt = 'Generate an image of a professional black and white vector logo. Subject: logo for "' + name + '". Structure: ' + (LT[logoType] || LT.icon_only) + ' Style: ' + styleInstr + (desc ? ' Context: ' + desc : '') + ' Visual constraints: high-contrast solid black shapes on a pure white background, no gradients, flat vector style. Return the image only, no text description.';
    } else {
      prompt = 'Generate a high-contrast black and white vector icon illustration of ' + name + '.' + (desc ? ' Description: ' + desc : '') + ' Style: ' + styleInstr + ' Visual constraints: solid black shapes on a pure white background, no text labels, no gradients. Return the image only, no text description.';
    }
    $('status').textContent = 'Dreaming in ' + styleVal + ' style…';
    const raster = await bridge.image({ prompt: prompt });
    $('status').textContent = 'Tracing vectors…';
    const svg = await bridge.trace(raster);
    const item = { name: name, style: styleVal, svg: svg, raster: raster };
    history.unshift(item);
    renderCard(item);
    refreshCount();
    $('status').textContent = '';
    $('name').value = ''; $('desc').value = '';
  } catch (e) {
    $('err').style.display = 'block'; $('err').textContent = (e && e.message) || 'Generation failed. Try again.';
    $('status').textContent = '';
  }
  go.disabled = false;
});
refreshCount();`;

export const SVG_GENERATOR_APP: AppConfig = {
  id: 'builtin_svggen',
  name: 'SVG Icon Generator',
  description: 'Generate crisp, vector-traced SVG icons & logos from a description — 65 styles, image-gen + tracing.',
  inputs: [],
  tier: 3,
  html,
  css,
  ui,
  permissions: ['image', 'trace', 'download'],
  reviewed: true, // built-in, ships with the extension — trusted
  createdAt: 0,
};
