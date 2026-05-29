import { useEffect, useRef, useState } from 'react';
import { AppHeader, appById } from '../AppsView';
import { Ic } from '../../ui/icons';
import { Segmented } from '../../ui/primitives';
import {
  adjustBrightness,
  crop,
  generateImage,
  loadImageToCanvas,
  rotate90,
  roundedCanvas,
  selectionToCrop,
  clampRadius,
} from '../../image';
import type { AspectRatio, CropRect, ImageStyle } from '../../image';

type Status =
  | { kind: 'idle' }
  | { kind: 'generating' }
  | { kind: 'editing' }
  | { kind: 'no-key' }
  | { kind: 'error'; message: string };

const MAX_PROMPT = 480;
type Sel = { x: number; y: number; w: number; h: number };

export function ImageApp({ onBack }: { onBack: () => void }) {
  const app = appById('image');
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState<AspectRatio>('1:1');
  const [style, setStyle] = useState<ImageStyle>('illustration');
  const [editPrompt, setEditPrompt] = useState('');
  const [radius, setRadius] = useState(0);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  // One canvas-backed working image drives BOTH generated + uploaded images, so
  // every tool (crop / rotate / brightness / AI-edit / rounded export) applies
  // to whatever is on screen. `versions` is the undo stack of prior data URLs.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [editUrl, setEditUrl] = useState<string | null>(null);
  const versions = useRef<string[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Interactive crop state.
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [cropping, setCropping] = useState(false);
  const [sel, setSel] = useState<Sel | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const busy = status.kind === 'generating' || status.kind === 'editing';

  function syncFromCanvas() {
    const canvas = canvasRef.current;
    if (canvas) setEditUrl(canvas.toDataURL('image/png'));
  }

  // Replace the working image with a new data URL, pushing the old onto undo.
  async function setImage(dataUrl: string, { keepHistory = true } = {}) {
    if (keepHistory && editUrl) {
      versions.current.push(editUrl);
      setCanUndo(true);
    } else if (!keepHistory) {
      versions.current = [];
      setCanUndo(false);
    }
    const { canvas } = await loadImageToCanvas(dataUrl);
    canvasRef.current = canvas;
    setEditUrl(dataUrl);
    setCropping(false);
    setSel(null);
  }

  async function onGenerate() {
    if (!prompt.trim() || busy) return;
    setStatus({ kind: 'generating' });
    const outcome = await generateImage({ prompt, aspect, style });
    if (outcome.ok) {
      await setImage(outcome.image.dataUrl, { keepHistory: false });
      setStatus({ kind: 'idle' });
    } else setStatus(outcome.reason === 'no-key' ? { kind: 'no-key' } : { kind: 'error', message: outcome.message });
  }

  // Iterate with AI: re-generate using the current image as the edit base.
  async function onAiEdit() {
    if (!editUrl || !editPrompt.trim() || busy) return;
    setStatus({ kind: 'editing' });
    const outcome = await generateImage({ prompt: editPrompt, inputImage: editUrl, aspect, style });
    if (outcome.ok) {
      await setImage(outcome.image.dataUrl);
      setEditPrompt('');
      setStatus({ kind: 'idle' });
    } else setStatus(outcome.reason === 'no-key' ? { kind: 'no-key' } : { kind: 'error', message: outcome.message });
  }

  async function onUndo() {
    const prev = versions.current.pop();
    setCanUndo(versions.current.length > 0);
    if (!prev) return;
    const { canvas } = await loadImageToCanvas(prev);
    canvasRef.current = canvas;
    setEditUrl(prev);
    setCropping(false);
    setSel(null);
  }

  function onUpload(file: File) {
    const reader = new FileReader();
    reader.onload = () => void setImage(String(reader.result), { keepHistory: false });
    reader.readAsDataURL(file);
  }

  // --- interactive crop (drag a box over the preview) ---
  function onCropPointerDown(e: React.PointerEvent) {
    if (!cropping || !imgRef.current) return;
    const r = imgRef.current.getBoundingClientRect();
    dragStart.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    setSel({ x: dragStart.current.x, y: dragStart.current.y, w: 0, h: 0 });
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onCropPointerMove(e: React.PointerEvent) {
    if (!cropping || !dragStart.current || !imgRef.current) return;
    const r = imgRef.current.getBoundingClientRect();
    const cx = Math.max(0, Math.min(e.clientX - r.left, r.width));
    const cy = Math.max(0, Math.min(e.clientY - r.top, r.height));
    const s = dragStart.current;
    setSel({ x: Math.min(s.x, cx), y: Math.min(s.y, cy), w: Math.abs(cx - s.x), h: Math.abs(cy - s.y) });
  }
  function applyCrop() {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !sel || sel.w < 6 || sel.h < 6) { setCropping(false); setSel(null); return; }
    const rect: CropRect = { x: sel.x, y: sel.y, width: sel.w, height: sel.h };
    const mapped = selectionToCrop(rect, img.clientWidth, img.clientHeight, canvas.width, canvas.height);
    versions.current.push(editUrl!);
    setCanUndo(true);
    canvasRef.current = crop(canvas, mapped);
    setCropping(false);
    setSel(null);
    syncFromCanvas();
  }

  function onRotate() {
    if (!canvasRef.current) return;
    versions.current.push(editUrl!); setCanUndo(true);
    canvasRef.current = rotate90(canvasRef.current);
    syncFromCanvas();
  }
  function onBrighten(delta: number) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    versions.current.push(editUrl!); setCanUndo(true);
    adjustBrightness(ctx, delta);
    syncFromCanvas();
  }

  function onDownload() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Build the Blob SYNCHRONOUSLY (in the click gesture) and download via an
    // object URL — async toBlob loses the user-activation and the browser
    // blocks the download. Rounded export clips to a rounded rect first.
    const target = radius > 0 ? roundedCanvas(canvas, radius) : canvas;
    const dataUrl = target.toDataURL('image/png');
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chrome-buddy-image.png';
    a.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => () => { setEditUrl(null); versions.current = []; }, []);

  const maxRadius = canvasRef.current ? Math.floor(Math.min(canvasRef.current.width, canvasRef.current.height) / 2) : 256;
  const showEditor = editUrl !== null;
  const showEmpty = !showEditor && !busy && status.kind !== 'no-key' && status.kind !== 'error';

  return (
    <div className="micro" data-testid="image-app">
      <AppHeader app={app} onBack={onBack} />
      <div className="micro-body">
        <div className="img-prompt">
          <textarea
            className="img-prompt-ta"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value.slice(0, MAX_PROMPT))}
            rows={3}
            placeholder="Describe an image to generate…"
          />
          <div className="img-prompt-foot">
            <span className="img-prompt-meta">{prompt.length} / {MAX_PROMPT}</span>
            <button type="button" className="btn btn-primary btn-sm" disabled={!prompt.trim() || busy} onClick={onGenerate}>
              <span className="ic ic-sm">{Ic.sparkle}</span>{status.kind === 'generating' ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </div>

        <div className="seg-row">
          <span className="seg-row-l">Aspect</span>
          <Segmented value={aspect} onChange={(v) => setAspect(v as AspectRatio)}
            options={[{ v: '1:1', l: '1:1' }, { v: '3:2', l: '3:2' }, { v: '16:9', l: '16:9' }, { v: '9:16', l: '9:16' }]} />
        </div>
        <div className="seg-row">
          <span className="seg-row-l">Style</span>
          <Segmented value={style} onChange={(v) => setStyle(v as ImageStyle)}
            options={[{ v: 'photo', l: 'Photo' }, { v: 'illustration', l: 'Illustration' }, { v: '3d', l: '3D' }]} />
        </div>

        {showEditor && editUrl && (
          <>
            <div className={'img-result' + (cropping ? ' is-cropping' : '')}>
              <div
                className="img-crop-stage"
                onPointerDown={onCropPointerDown}
                onPointerMove={onCropPointerMove}
                onPointerUp={() => { dragStart.current = null; }}
              >
                <img ref={imgRef} className="art" src={editUrl} alt="Working image" draggable={false} />
                {cropping && sel && sel.w > 0 && (
                  <div className="img-crop-box" style={{ left: sel.x, top: sel.y, width: sel.w, height: sel.h }} />
                )}
              </div>
              <div className="img-result-actions">
                {canUndo && (
                  <button type="button" className="img-tool" aria-label="Undo" title="Undo" onClick={() => void onUndo()}>
                    <span className="ic">{Ic.history}</span>
                  </button>
                )}
                <button type="button" className="img-tool" aria-label="Download PNG" title="Download PNG" onClick={onDownload}>
                  <span className="ic">{Ic.download}</span>
                </button>
              </div>
            </div>

            {/* Iterate with AI */}
            <div className="img-edit-row">
              <input
                className="settings-input"
                placeholder="Change it… e.g. make the sky sunset, add a hat"
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void onAiEdit(); }}
                aria-label="Edit instruction"
                disabled={busy}
              />
              <button type="button" className="btn btn-primary btn-sm" disabled={busy || !editPrompt.trim()} onClick={() => void onAiEdit()}>
                {status.kind === 'editing' ? 'Editing…' : 'Edit with AI'}
              </button>
            </div>

            {/* Manual edit tools */}
            <div className="seg-row">
              <span className="seg-row-l">Edit</span>
              <div className="seg" role="group" aria-label="Edit tools">
                <button type="button" className={'seg-btn' + (cropping ? ' is-on' : '')} onClick={() => { setCropping((c) => !c); setSel(null); }}>{cropping ? 'Cancel' : 'Crop'}</button>
                {cropping && <button type="button" className="seg-btn" onClick={applyCrop}>Apply</button>}
                <button type="button" className="seg-btn" onClick={onRotate}>Rotate</button>
                <button type="button" className="seg-btn" onClick={() => onBrighten(12)}>Brighter</button>
                <button type="button" className="seg-btn" onClick={() => onBrighten(-12)}>Darker</button>
              </div>
            </div>
            {cropping && <div className="empty-state-desc" style={{ fontSize: 11 }}>Drag a box on the image, then tap Apply.</div>}

            {/* Rounded-corner PNG export */}
            <div className="seg-row">
              <span className="seg-row-l">Corners</span>
              <div className="img-radius">
                <input type="range" min={0} max={maxRadius} value={Math.min(radius, maxRadius)} onChange={(e) => setRadius(Number(e.target.value))} aria-label="Corner radius" />
                <span className="img-radius-val">{radius ? `${clampRadius(radius, canvasRef.current?.width ?? 0, canvasRef.current?.height ?? 0)}px round` : 'square'}</span>
              </div>
            </div>
          </>
        )}

        {status.kind === 'generating' && (
          <div className="empty-state"><span className="ic" style={{ width: 28, height: 28 }}>{Ic.sparkle}</span>
            <div className="empty-state-title">Generating…</div></div>
        )}
        {status.kind === 'no-key' && (
          <div className="empty-state"><span className="ic" style={{ width: 28, height: 28 }}>{Ic.warn}</span>
            <div className="empty-state-title">Add an API key in Settings to generate</div>
            <div className="empty-state-desc">Image generation runs through your own Gemini key.</div></div>
        )}
        {status.kind === 'error' && (
          <div className="empty-state"><span className="ic" style={{ width: 28, height: 28 }}>{Ic.warn}</span>
            <div className="empty-state-title">Couldn’t generate that image</div>
            <div className="empty-state-desc">{status.message}</div></div>
        )}
        {showEmpty && (
          <div className="empty-state"><span className="ic" style={{ width: 28, height: 28 }}>{Ic.image}</span>
            <div className="empty-state-title">Your image will appear here</div>
            <div className="empty-state-desc">Generate from a prompt, or upload a photo — then iterate with AI, crop, and export with rounded corners.</div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()}><span className="ic ic-sm">{Ic.image}</span>Upload a photo</button>
          </div>
        )}
        {showEditor && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()}><span className="ic ic-sm">{Ic.image}</span>Upload a different photo</button>
        )}

        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }} />
      </div>
    </div>
  );
}
