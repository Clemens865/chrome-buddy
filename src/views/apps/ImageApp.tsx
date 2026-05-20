import { useState } from 'react';
import { AppHeader, appById } from '../AppsView';
import { Ic } from '../../ui/icons';
import { Segmented } from '../../ui/primitives';

// Empty/initial state. Real generation (Imagen 4 / Nano Banana) + canvas editing
// is wired in the Image Studio wave. No mock images.
export function ImageApp({ onBack }: { onBack: () => void }) {
  const app = appById('image');
  const [prompt, setPrompt] = useState('');
  const [ratio, setRatio] = useState('1:1');
  const [style, setStyle] = useState('illustration');
  return (
    <div className="micro">
      <AppHeader app={app} onBack={onBack} />
      <div className="micro-body">
        <div className="img-prompt">
          <textarea className="img-prompt-ta" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder="Describe an image to generate…" />
          <div className="img-prompt-foot">
            <span className="img-prompt-meta">{prompt.length} / 480</span>
            <button type="button" className="btn btn-primary btn-sm" disabled={!prompt.trim()}><span className="ic ic-sm">{Ic.sparkle}</span>Generate</button>
          </div>
        </div>

        <div className="seg-row">
          <span className="seg-row-l">Aspect</span>
          <Segmented value={ratio} onChange={setRatio} options={[{ v: '1:1', l: '1:1' }, { v: '3:2', l: '3:2' }, { v: '16:9', l: '16:9' }, { v: '9:16', l: '9:16' }]} />
        </div>
        <div className="seg-row">
          <span className="seg-row-l">Style</span>
          <Segmented value={style} onChange={setStyle} options={[{ v: 'photo', l: 'Photo' }, { v: 'illustration', l: 'Illustration' }, { v: '3d', l: '3D' }]} />
        </div>

        <div className="empty-state">
          <span className="ic" style={{ width: 28, height: 28 }}>{Ic.image}</span>
          <div className="empty-state-title">Your image will appear here</div>
          <div className="empty-state-desc">Write a prompt and generate, or upload a photo to edit with crop and AI tools.</div>
          <button type="button" className="btn btn-ghost btn-sm"><span className="ic ic-sm">{Ic.download}</span>Upload a photo to edit</button>
        </div>
      </div>
    </div>
  );
}
