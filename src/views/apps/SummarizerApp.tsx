import { useState } from 'react';
import { AppHeader, appById } from '../AppsView';
import { Segmented } from '../../ui/primitives';
import { Ic } from '../../ui/icons';

// Empty/initial state. Real summarization is wired to the LLM client + PageContext
// in a later wave; for now it shows the controls and an empty result.
export function SummarizerApp({ onBack }: { onBack: () => void }) {
  const [length, setLength] = useState('medium');
  const app = appById('summarizer');
  return (
    <div className="micro">
      <AppHeader app={app} onBack={onBack} />
      <div className="micro-body">
        <div className="seg-row">
          <span className="seg-row-l">Length</span>
          <Segmented value={length} onChange={setLength} options={[{ v: 'short', l: 'Short' }, { v: 'medium', l: 'Medium' }, { v: 'long', l: 'Long' }]} />
        </div>

        <div className="empty-state">
          <span className="ic" style={{ width: 28, height: 28 }}>{Ic.reader}</span>
          <div className="empty-state-title">Summarize this page</div>
          <div className="empty-state-desc">Capture the current tab and distill it into a TL;DR with key points and sources.</div>
          <button type="button" className="btn btn-primary"><span className="ic ic-sm">{Ic.sparkle}</span>Summarize current page</button>
        </div>
      </div>
    </div>
  );
}
