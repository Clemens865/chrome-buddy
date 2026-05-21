// Artifact card (shown in chat) + the full-panel artifact viewer (copy/download,
// back to chat). Expandable view — chosen over a split because the side panel is
// too narrow to split usefully.
import { useState } from 'react';
import { Ic } from '../ui/icons';
import { artifactFilename, type Artifact } from '../artifacts/extract';

export function ArtifactCard({ artifact, onOpen }: { artifact: Artifact; onOpen: () => void }) {
  return (
    <button type="button" className="artifact-card" onClick={onOpen}>
      <span className="artifact-card-ic"><span className="ic">{Ic.console}</span></span>
      <div className="artifact-card-body">
        <div className="artifact-card-title">{artifact.title}</div>
        <div className="artifact-card-sub">{artifact.language} · {artifact.content.split('\n').length} lines</div>
      </div>
      <span className="artifact-card-open">Open</span>
    </button>
  );
}

export function ArtifactView({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(artifact.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([artifact.content], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = artifactFilename(artifact);
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="artifact-view">
      <header className="artifact-hd">
        <button type="button" className="app-hd-back" aria-label="Back to chat" onClick={onClose}>
          <span className="ic">{Ic.collapse}</span>
        </button>
        <div className="artifact-hd-text">
          <div className="artifact-hd-title">{artifact.title}</div>
          <div className="artifact-hd-sub">{artifact.language}</div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={download}>Download</button>
      </header>
      <pre className="artifact-code"><code>{artifact.content}</code></pre>
    </div>
  );
}
