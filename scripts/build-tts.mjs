import { writeFileSync } from 'node:fs';

const html = `
<div class="cb-app">
  <h1>Text to Speech</h1>
  <p class="hint cb-muted">Paste text, upload a document, or grab the current page — clean it up or summarize it in a style, then hear it in a natural Google voice.</p>

  <div class="seg" id="srcSeg" role="group" aria-label="Source">
    <button type="button" class="seg-btn active" data-s="paste">Paste</button>
    <button type="button" class="seg-btn" data-s="file">Upload</button>
    <button type="button" class="seg-btn" data-s="page">This page</button>
  </div>
  <input id="file" type="file" accept=".txt,.md,.markdown,.mdx,.text,.rst,.csv,.json,.html,.htm,.xml,text/*" hidden />

  <textarea id="text" class="cb-input" rows="7" placeholder="Paste or type text to read aloud…"></textarea>
  <div id="meta" class="small cb-muted"></div>

  <label class="lbl" style="margin-top:10px">Prepare (optional — uses AI)</label>
  <div class="prep-row">
    <select id="prep" class="cb-input"></select>
    <button id="prepBtn" type="button" class="cb-btn cb-ghost" disabled>✨ Prepare</button>
  </div>

  <div class="row2">
    <div class="col">
      <label class="lbl">Voice</label>
      <select id="voice" class="cb-input"></select>
    </div>
    <div class="col">
      <label class="lbl">Tone</label>
      <select id="tone" class="cb-input"></select>
    </div>
  </div>

  <div class="btns">
    <button id="preview" type="button" class="cb-btn cb-ghost">▶ Preview voice</button>
    <button id="speak" type="button" class="cb-btn primary" disabled>Speak</button>
  </div>
  <div id="status" class="status cb-muted"></div>

  <audio id="player" controls style="display:none; width:100%; margin-top:10px"></audio>
  <div id="actions" class="actions" style="display:none">
    <button id="dl" type="button" class="cb-btn cb-ghost">Download .wav</button>
  </div>
</div>`;

const css = `
.cb-app { font-family: system-ui, sans-serif; color: var(--cb-fg); padding: 12px; }
h1 { font-size: 17px; margin: 0 0 4px; }
.hint { font-size: 12px; margin: 0 0 10px; }
.small { font-size: 11px; margin-top: 4px; }
.seg { display: flex; gap: 4px; margin-bottom: 8px; }
.seg-btn { flex: 1; padding: 7px 4px; border: 1px solid var(--cb-border); border-radius: 8px; background: var(--cb-bg); color: var(--cb-fg); font: inherit; font-size: 12px; cursor: pointer; }
.seg-btn.active { background: var(--cb-accent); color: #fff; border-color: var(--cb-accent); }
.cb-input { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--cb-border); border-radius: 8px; font: inherit; background: var(--cb-bg); color: var(--cb-fg); resize: vertical; }
.prep-row { display: flex; gap: 6px; }
.prep-row select { flex: 1; min-width: 0; }
.prep-row .cb-btn { margin: 0; white-space: nowrap; }
.row2 { display: flex; gap: 8px; margin-top: 10px; }
.col { flex: 1; min-width: 0; }
.lbl { display: block; font-size: 11px; font-weight: 600; color: var(--cb-muted); margin-bottom: 3px; }
.btns { display: flex; gap: 6px; margin-top: 12px; }
.cb-btn { padding: 9px 12px; border: 1px solid var(--cb-border); border-radius: 8px; font: inherit; font-weight: 600; cursor: pointer; background: var(--cb-elev); color: var(--cb-fg); }
.cb-btn.primary { flex: 1; background: var(--cb-accent); color: #fff; border-color: var(--cb-accent); }
.cb-btn.cb-ghost { background: transparent; }
.cb-btn:disabled { opacity: .6; cursor: default; }
.status { font-size: 12px; margin: 8px 0 0; min-height: 14px; }
.actions { display: flex; gap: 6px; margin-top: 10px; }`;

const ui = `
const $ = (id) => root.querySelector('#' + id);
const VOICES = [['Zephyr','Bright'],['Puck','Upbeat'],['Charon','Informative'],['Kore','Firm'],['Fenrir','Excitable'],['Leda','Youthful'],['Orus','Firm'],['Aoede','Breezy'],['Callirrhoe','Easy-going'],['Autonoe','Bright'],['Enceladus','Breathy'],['Iapetus','Clear'],['Umbriel','Easy-going'],['Algieba','Smooth'],['Despina','Smooth'],['Erinome','Clear'],['Algenib','Gravelly'],['Rasalgethi','Informative'],['Laomedeia','Upbeat'],['Achernar','Soft'],['Alnilam','Firm'],['Schedar','Even'],['Gacrux','Mature'],['Pulcherrima','Forward'],['Achird','Friendly'],['Zubenelgenubi','Casual'],['Vindemiatrix','Gentle'],['Sadachbia','Lively'],['Sadaltager','Knowledgeable'],['Sulafat','Warm']];
const voiceSel = $('voice');
VOICES.forEach(function (v) { const o = document.createElement('option'); o.value = v[0]; o.textContent = v[0] + ' — ' + v[1]; voiceSel.appendChild(o); });
voiceSel.value = 'Kore';

const TONES = {
  'Natural': function (t) { return t; },
  'Cheerful': function (t) { return 'Say cheerfully: ' + t; },
  'Calm narrator': function (t) { return 'Read this in a calm, measured narrator voice:\\n\\n' + t; },
  'Excited': function (t) { return '[excited] ' + t; },
  'Serious': function (t) { return '[serious] ' + t; },
  'Whisper': function (t) { return '[whispers] ' + t; }
};
const toneSel = $('tone');
Object.keys(TONES).forEach(function (k) { const o = document.createElement('option'); o.value = k; o.textContent = k; toneSel.appendChild(o); });

// Prepare styles — transform the text with the LLM before reading it aloud.
const PREP = {
  'Read as-is': null,
  'Clean up (remove nav/ads)': 'Clean up this web page text for reading aloud: remove navigation, menus, ads, cookie/consent notices, share buttons, repeated boilerplate and any code; keep the REAL article/content as clear flowing prose. Do not summarize — keep the full content, just cleaned. Return ONLY the cleaned text.',
  'Summary': 'Summarize the following for listening: a clear spoken summary in a few short paragraphs covering the key points. Return ONLY the summary.',
  'Key points': 'Extract the key points of the following as a short spoken list of 5 to 8 items, each a complete sentence so it reads naturally aloud. Return ONLY the points.',
  'TL;DR (2-3 sentences)': 'Give a 2 to 3 sentence TL;DR of the following, suitable for reading aloud. Return ONLY the TL;DR.',
  'Explain simply': 'Explain the following in simple, plain language anyone can follow, as if narrating to a curious friend. Return ONLY the explanation.',
  'Narration (podcast style)': 'Rewrite the following as an engaging spoken narration — natural and flowing, like a short podcast segment, faithful to the content. Return ONLY the narration.'
};
const prepSel = $('prep');
Object.keys(PREP).forEach(function (k) { const o = document.createElement('option'); o.value = k; o.textContent = k; prepSel.appendChild(o); });

const MAX = 16000;
const textEl = $('text');
function refreshMeta() {
  const n = textEl.value.trim().length;
  $('speak').disabled = n === 0;
  $('prepBtn').disabled = n === 0 || !PREP[prepSel.value];
  $('meta').textContent = n ? (n.toLocaleString() + ' characters' + (n > MAX ? ' · only the first ' + MAX.toLocaleString() + ' will be read — Prepare → Summary to shorten' : '')) : '';
}
textEl.addEventListener('input', refreshMeta);
prepSel.addEventListener('change', refreshMeta);

// Prepare: transform the current text with the chosen style.
$('prepBtn').addEventListener('click', async function () {
  const t = textEl.value.trim(); const instr = PREP[prepSel.value];
  if (!t || !instr) return;
  const btn = $('prepBtn'); const old = btn.textContent; btn.disabled = true; btn.textContent = '✨ Preparing…'; $('status').textContent = 'Preparing the text with AI…';
  try {
    const out = await bridge.gemini(instr + '\\n\\nText:\\n' + t.slice(0, 100000));
    textEl.value = String(out || '').trim();
    $('status').textContent = 'Prepared — edit if you like, then press Speak.';
    refreshMeta();
  } catch (e) { $('status').textContent = 'Could not prepare: ' + ((e && e.message) || 'error'); }
  btn.disabled = false; btn.textContent = old;
});

// --- Source switcher ---
const seg = $('srcSeg');
seg.querySelectorAll('.seg-btn').forEach(function (b) {
  b.addEventListener('click', async function () {
    const s = b.getAttribute('data-s');
    if (s === 'file') { $('file').click(); return; }
    if (s === 'page') {
      seg.querySelectorAll('.seg-btn').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active'); $('status').textContent = 'Reading the current page…';
      try {
        const p = await bridge.page();
        textEl.value = (p && p.text ? p.text : '').trim();
        $('status').textContent = p && p.title ? ('Loaded: ' + p.title + ' — try Prepare to clean or summarize it.') : '';
        setActive('paste'); refreshMeta();
      } catch (e) { $('status').textContent = 'Could not read the page: ' + ((e && e.message) || 'error'); }
      return;
    }
    setActive('paste');
  });
});
function setActive(s) { seg.querySelectorAll('.seg-btn').forEach(function (x) { x.classList.toggle('active', x.getAttribute('data-s') === s); }); }
$('file').addEventListener('change', function () {
  const f = $('file').files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = function () { textEl.value = String(r.result || '').trim(); $('status').textContent = 'Loaded: ' + f.name; setActive('paste'); refreshMeta(); };
  r.onerror = function () { $('status').textContent = 'Could not read that file (text files only).'; };
  r.readAsText(f);
});

// --- Speak / Preview / Download ---
let lastUrl = null;
const player = $('player');
async function synth(text, btn) {
  const old = btn.textContent; btn.disabled = true; $('status').textContent = 'Generating speech…';
  try {
    const url = await bridge.tts({ text: text.slice(0, MAX), voice: voiceSel.value });
    lastUrl = url; player.src = url; player.style.display = 'block'; $('actions').style.display = 'flex'; $('status').textContent = '';
    try { await player.play(); } catch (e) { /* user can press play */ }
  } catch (e) { $('status').textContent = 'Error: ' + ((e && e.message) || 'speech failed') + ' — TTS is preview; try again.'; }
  btn.disabled = false; btn.textContent = old;
}
$('speak').addEventListener('click', function () { const t = textEl.value.trim(); if (!t) return; synth(TONES[toneSel.value](t), $('speak')); });
$('preview').addEventListener('click', function () { synth('Hi, this is the ' + voiceSel.value + ' voice — natural, clear and ready to read your text.', $('preview')); });
$('dl').addEventListener('click', function () { if (lastUrl) api.download('speech.wav', lastUrl); });

refreshMeta();`;

const bundle = {
  schemaVersion: 2,
  apps: [
    {
      id: 'text-to-speech',
      name: 'Text to Speech',
      description:
        'Paste text, upload a document, or grab the current page in one click — then optionally clean it up or summarize it in a style (Summary, Key points, TL;DR, Narration…) before hearing it in a natural Google voice. 30 voices with previews, tone presets, and WAV download.',
      inputs: [],
      tier: 3,
      html,
      css,
      ui,
      permissions: ['tts', 'page', 'gemini', 'download'],
      reviewed: false,
      createdAt: 0,
    },
  ],
};

writeFileSync(process.argv[2], JSON.stringify(bundle, null, 2) + '\n');
console.log('wrote', process.argv[2]);

// Also emit the built-in (trusted → reviewed:true) so it ships in the default
// Apps grid. Single source of truth: this script; don't hand-edit the .ts.
if (process.argv[3]) {
  const builtin = { ...bundle.apps[0], reviewed: true };
  const ts =
    '// Built-in Tier-3 app: Text to Speech. GENERATED from scripts/build-tts.mjs —\n' +
    '// edit there and rerun (it also writes docs/catalog-seed/apps/text-to-speech.json).\n' +
    "import type { AppConfig } from '../types';\n\n" +
    'export const TEXT_TO_SPEECH_APP: AppConfig = ' + JSON.stringify(builtin, null, 2) + ';\n';
  writeFileSync(process.argv[3], ts);
  console.log('wrote', process.argv[3]);
}
