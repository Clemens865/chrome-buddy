// Audio Transcriber app: upload an audio file, play it back, and transcribe it
// to text via Gemini (native generateContent, audio inlineData). Needs the file
// input + <audio> playback, so it's a real app rather than a chat prompt.
import { useEffect, useRef, useState } from 'react';
import { AppHeader, appById } from '../AppsView';
import { Ic } from '../../ui/icons';
import { Markdown } from '../../ui/Markdown';
import { fileToBase64, transcribeAudio } from '../../audio/request';

type Status =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; text: string }
  | { kind: 'error'; message: string };

export function TranscriberApp({ onBack }: { onBack: () => void }) {
  const app = appById('transcriber');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const pick = (f: File | null) => {
    if (!f) return;
    if (url) URL.revokeObjectURL(url);
    setFile(f);
    setUrl(URL.createObjectURL(f));
    setStatus({ kind: 'idle' });
  };

  const run = async () => {
    if (!file) return;
    setStatus({ kind: 'working' });
    try {
      const base64 = await fileToBase64(file);
      const res = await transcribeAudio(base64, file.type || 'audio/wav');
      if (res.ok) setStatus({ kind: 'done', text: res.text ?? '' });
      else setStatus({ kind: 'error', message: res.error ?? 'Transcription failed.' });
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const copy = () => {
    if (status.kind === 'done') void navigator.clipboard?.writeText(status.text).catch(() => {});
  };

  return (
    <div className="micro">
      <AppHeader app={app} onBack={onBack} />
      <div className="micro-body">
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          style={{ display: 'none' }}
          aria-label="Audio file"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />

        {!file ? (
          <div className="empty-state">
            <span className="ic" style={{ width: 28, height: 28 }}>{Ic.mic}</span>
            <div className="empty-state-title">Transcribe audio</div>
            <div className="empty-state-desc">Pick an audio file (meeting, voice note, recording) and Buddy turns it into text.</div>
            <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()}>
              <span className="ic ic-sm">{Ic.attach}</span>Choose audio file
            </button>
          </div>
        ) : (
          <>
            <div className="tr-file">
              <span className="tr-file-name">{file.name}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => inputRef.current?.click()}>Change</button>
            </div>
            {url && <audio className="tr-audio" src={url} controls />}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              style={{ marginTop: 8 }}
              disabled={status.kind === 'working'}
              onClick={() => void run()}
            >
              {status.kind === 'working' ? 'Transcribing…' : 'Transcribe'}
            </button>

            {status.kind === 'error' && (
              <div className="empty-state-desc" style={{ color: '#B91C1C', marginTop: 10 }}>{status.message}</div>
            )}
            {status.kind === 'done' && (
              <div className="tr-result">
                <div className="tr-result-hd">
                  <span>Transcript</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>Copy</button>
                </div>
                <div className="msg-body"><Markdown>{status.text || '_(no speech detected)_'}</Markdown></div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
