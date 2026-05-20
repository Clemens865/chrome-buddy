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
} from '../../image';
import type { AspectRatio, GeneratedImage, ImageStyle } from '../../image';

type Status =
  | { kind: 'idle' }
  | { kind: 'generating' }
  | { kind: 'no-key' }
  | { kind: 'error'; message: string };

const MAX_PROMPT = 480;

export function ImageApp({ onBack }: { onBack: () => void }) {
  const app = appById('image');
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState<AspectRatio>('1:1');
  const [style, setStyle] = useState<ImageStyle>('illustration');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [generated, setGenerated] = useState<GeneratedImage | null>(null);

  // The editable upload lives on a canvas; we mirror it into a data URL for the
  // preview <img> and re-render on each edit.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [editUrl, setEditUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const busy = status.kind === 'generating';

  async function onGenerate() {
    if (!prompt.trim() || busy) return;
    setStatus({ kind: 'generating' });
    setGenerated(null);
    const outcome = await generateImage({ prompt, aspect, style });
    if (outcome.ok) {
      setGenerated(outcome.image);
      setStatus({ kind: 'idle' });
    } else if (outcome.reason === 'no-key') {
      setStatus({ kind: 'no-key' });
    } else {
      setStatus({ kind: 'error', message: outcome.message });
    }
  }

  function syncEditUrl() {
    const canvas = canvasRef.current;
    if (canvas) setEditUrl(canvas.toDataURL('image/png'));
  }

  async function onUpload(file: File) {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result);
      const { canvas } = await loadImageToCanvas(dataUrl);
      canvasRef.current = canvas;
      setGenerated(null);
      setStatus({ kind: 'idle' });
      syncEditUrl();
    };
    reader.readAsDataURL(file);
  }

  function onCrop() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Center crop to 80% — a simple deterministic edit (clamped in helper).
    const w = Math.round(canvas.width * 0.8);
    const h = Math.round(canvas.height * 0.8);
    canvasRef.current = crop(canvas, {
      x: Math.round((canvas.width - w) / 2),
      y: Math.round((canvas.height - h) / 2),
      width: w,
      height: h,
    });
    syncEditUrl();
  }

  function onRotate() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvasRef.current = rotate90(canvas);
    syncEditUrl();
  }

  function onBrighten(delta: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    adjustBrightness(ctx, delta);
    syncEditUrl();
  }

  function download(url: string, name: string) {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
  }

  // Revoke nothing (data URLs), but reset edit state when leaving via back.
  useEffect(() => () => setEditUrl(null), []);

  const showEditor = editUrl !== null;
  const showResult = generated !== null;
  const showEmpty = !showEditor && !showResult && status.kind !== 'generating';

  return (
    <div className="micro">
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
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!prompt.trim() || busy}
              onClick={onGenerate}
            >
              <span className="ic ic-sm">{Ic.sparkle}</span>
              {busy ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </div>

        <div className="seg-row">
          <span className="seg-row-l">Aspect</span>
          <Segmented
            value={aspect}
            onChange={(v) => setAspect(v as AspectRatio)}
            options={[{ v: '1:1', l: '1:1' }, { v: '3:2', l: '3:2' }, { v: '16:9', l: '16:9' }, { v: '9:16', l: '9:16' }]}
          />
        </div>
        <div className="seg-row">
          <span className="seg-row-l">Style</span>
          <Segmented
            value={style}
            onChange={(v) => setStyle(v as ImageStyle)}
            options={[{ v: 'photo', l: 'Photo' }, { v: 'illustration', l: 'Illustration' }, { v: '3d', l: '3D' }]}
          />
        </div>

        {/* Generated image result */}
        {showResult && generated && (
          <div className="img-result">
            <img className="art" src={generated.dataUrl} alt={generated.prompt} />
            <div className="img-result-actions">
              <button
                type="button"
                className="img-tool"
                aria-label="Download image"
                title="Download"
                onClick={() => download(generated.dataUrl, 'chrome-buddy-image.png')}
              >
                <span className="ic">{Ic.download}</span>
              </button>
            </div>
          </div>
        )}

        {/* Uploaded photo editor */}
        {showEditor && editUrl && (
          <>
            <div className="img-result">
              <img className="art" src={editUrl} alt="Editing canvas" />
              <div className="img-result-actions">
                <button type="button" className="img-tool" aria-label="Download image" title="Download" onClick={() => download(editUrl, 'chrome-buddy-edit.png')}>
                  <span className="ic">{Ic.download}</span>
                </button>
              </div>
            </div>
            <div className="seg-row">
              <span className="seg-row-l">Edit</span>
              <div className="seg" role="group" aria-label="Edit tools">
                <button type="button" className="seg-btn" onClick={onCrop}>Crop</button>
                <button type="button" className="seg-btn" onClick={onRotate}>Rotate</button>
                <button type="button" className="seg-btn" onClick={() => onBrighten(12)}>Brighter</button>
                <button type="button" className="seg-btn" onClick={() => onBrighten(-12)}>Darker</button>
              </div>
            </div>
          </>
        )}

        {/* Generating placeholder */}
        {status.kind === 'generating' && (
          <div className="empty-state">
            <span className="ic" style={{ width: 28, height: 28 }}>{Ic.sparkle}</span>
            <div className="empty-state-title">Generating…</div>
            <div className="empty-state-desc">Asking the model to create your image.</div>
          </div>
        )}

        {/* No-key state */}
        {status.kind === 'no-key' && (
          <div className="empty-state">
            <span className="ic" style={{ width: 28, height: 28 }}>{Ic.warn}</span>
            <div className="empty-state-title">Add an API key in Settings to generate</div>
            <div className="empty-state-desc">Image generation runs through your own Gemini key. Open Settings to add one, then try again.</div>
          </div>
        )}

        {/* Error state */}
        {status.kind === 'error' && (
          <div className="empty-state">
            <span className="ic" style={{ width: 28, height: 28 }}>{Ic.warn}</span>
            <div className="empty-state-title">Couldn’t generate that image</div>
            <div className="empty-state-desc">{status.message}</div>
          </div>
        )}

        {/* Empty state */}
        {showEmpty && status.kind === 'idle' && (
          <div className="empty-state">
            <span className="ic" style={{ width: 28, height: 28 }}>{Ic.image}</span>
            <div className="empty-state-title">Your image will appear here</div>
            <div className="empty-state-desc">Write a prompt and generate, or upload a photo to edit with crop and AI tools.</div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()}>
              <span className="ic ic-sm">{Ic.download}</span>Upload a photo to edit
            </button>
          </div>
        )}

        {!showEmpty && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()}>
            <span className="ic ic-sm">{Ic.download}</span>Upload a photo to edit
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onUpload(file);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
