// Voice Transcriber — record → transcribe → sessions → transforms.
//
// Robust record-then-transcribe flow (NOT the flaky Live WebSocket): the mic is
// captured as 16 kHz mono PCM, encoded to a WAV blob on stop, and transcribed in
// one shot via Gemini audio understanding. Each recording is saved as a SESSION
// (title · date · time · length) in IndexedDB, listed like chat history. From a
// session the user runs post-processing TRANSFORMS — summarize, clean up, meeting
// notes, add speakers — each saved back onto the session as its own tab.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppHeader, appById } from '../AppsView';
import { Ic } from '../../ui/icons';
import { MicRecorder } from '../../transcribe/recorder';
import { fileToBase64, transcribeAudio } from '../../audio/request';
import { generateViaBackground } from '../../llm/instance';
import {
  listSessions, saveSession, deleteSession as deleteSessionDb, type TranscriptSession,
} from '../../transcribe/store';
import {
  TRANSFORMS, transformDef, deriveTitle, formatDuration, type TransformKind,
} from '../../transcribe/transforms';

type RecState = 'idle' | 'recording' | 'transcribing';
type Tab = 'transcript' | TransformKind;

function genId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `ts-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function formatWhen(epochMs: number): string {
  const d = new Date(epochMs);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function LiveTranscriberApp({ onBack }: { onBack: () => void }) {
  const app = appById('livescribe');
  const recorderRef = useRef<MicRecorder | null>(null);
  const timerRef = useRef<number | null>(null);

  const [recState, setRecState] = useState<RecState>('idle');
  const [elapsed, setElapsed] = useState<number>(0);
  const [error, setError] = useState<string | undefined>();
  const [sessions, setSessions] = useState<TranscriptSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('transcript');
  const [running, setRunning] = useState<TransformKind | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const selected = useMemo(
    () => sessions.find((s) => s.id === selectedId) ?? null,
    [sessions, selectedId],
  );

  const refresh = useCallback(async () => {
    try { setSessions(await listSessions()); } catch { /* ignore */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Tick the elapsed timer while recording.
  useEffect(() => {
    if (recState !== 'recording') {
      if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    const startedAt = Date.now();
    setElapsed(0);
    timerRef.current = window.setInterval(() => setElapsed(Date.now() - startedAt), 250);
    return () => { if (timerRef.current) window.clearInterval(timerRef.current); };
  }, [recState]);

  // Stop the mic if the view unmounts mid-recording.
  useEffect(() => () => { void recorderRef.current?.cancel(); }, []);

  const startRec = useCallback(async () => {
    setError(undefined);
    const rec = new MicRecorder();
    recorderRef.current = rec;
    try {
      await rec.start();
      setRecState('recording');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not access the microphone.');
      recorderRef.current = null;
      setRecState('idle');
    }
  }, []);

  const stopRec = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    recorderRef.current = null;
    setRecState('transcribing');
    try {
      const out = await rec.stop();
      if (out.sampleCount === 0) {
        setError('No audio was captured — check your microphone and try again.');
        setRecState('idle');
        return;
      }
      const base64 = await fileToBase64(new Blob([out.wav as BlobPart], { type: out.mimeType }));
      const res = await transcribeAudio(base64, out.mimeType);
      if (!res.ok || !res.text?.trim()) {
        setError(res.error ?? 'Transcription returned nothing.');
        setRecState('idle');
        return;
      }
      const transcript = res.text.trim();
      const createdAt = Date.now() - out.durationMs;
      const session: TranscriptSession = {
        id: genId(),
        title: deriveTitle(transcript, createdAt),
        createdAt,
        durationMs: out.durationMs,
        transcript,
        transforms: {},
        updatedAt: Date.now(),
      };
      await saveSession(session);
      await refresh();
      setSelectedId(session.id);
      setTab('transcript');
      setRecState('idle');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transcription failed.');
      setRecState('idle');
    }
  }, [refresh]);

  const runTransform = useCallback(async (kind: TransformKind) => {
    if (!selected || running) return;
    setRunning(kind);
    setError(undefined);
    try {
      const def = transformDef(kind);
      const result = await generateViaBackground({
        messages: [{ role: 'user', content: def.prompt(selected.transcript) }],
      });
      const text = (result.text ?? '').trim();
      if (!text) throw new Error('The model returned nothing.');
      const updated: TranscriptSession = {
        ...selected,
        transforms: { ...selected.transforms, [kind]: text },
        updatedAt: Date.now(),
      };
      await saveSession(updated);
      setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setTab(kind);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transform failed.');
    } finally {
      setRunning(null);
    }
  }, [selected, running]);

  const removeSession = useCallback(async (id: string) => {
    try { await deleteSessionDb(id); } catch { /* ignore */ }
    if (selectedId === id) setSelectedId(null);
    await refresh();
  }, [selectedId, refresh]);

  // The text currently shown in the detail (transcript or a transform output).
  const activeText = useMemo(() => {
    if (!selected) return '';
    return tab === 'transcript' ? selected.transcript : selected.transforms[tab] ?? '';
  }, [selected, tab]);

  const onCopy = useCallback(async () => {
    if (!activeText) return;
    try {
      await navigator.clipboard.writeText(activeText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch { /* ignore */ }
  }, [activeText]);

  const onSaveToLibrary = useCallback(async () => {
    if (!selected || !activeText) return;
    const label = tab === 'transcript' ? 'Transcript' : transformDef(tab).label;
    const title = `${selected.title} — ${label}`;
    try {
      const r = (await chrome.runtime.sendMessage({
        type: 'LIBRARY_INDEX', source: 'manual', sourceRef: `voice-${selected.id}-${tab}`,
        title, content: `# ${title}\n\n${activeText}`,
      })) as { ok: boolean; result: { ok: boolean } } | undefined;
      if (r?.ok && r.result.ok) { setSaved(true); window.setTimeout(() => setSaved(false), 1800); }
    } catch { /* ignore */ }
  }, [selected, activeText, tab]);

  const isBusy = recState === 'recording' || recState === 'transcribing';

  return (
    <div className="micro">
      <AppHeader app={app} onBack={onBack} />

      {/* Record bar — always visible. */}
      <div className="live-bar">
        <button
          type="button"
          className={'voice-btn' + (recState === 'recording' ? ' is-on' : '')}
          disabled={recState === 'transcribing'}
          onClick={recState === 'recording' ? () => void stopRec() : () => void startRec()}
          data-testid={recState === 'recording' ? 'rec-stop' : 'rec-start'}
        >
          <span className="ic">{recState === 'recording' ? Ic.stop : Ic.mic}</span>
          <span>{recState === 'recording' ? 'Stop' : 'Record'}</span>
        </button>
        <span className={'voice-state voice-state-' + recState}>
          {recState === 'recording'
            ? `● Recording · ${formatDuration(elapsed)}`
            : recState === 'transcribing'
              ? 'Transcribing…'
              : error
                ? error
                : 'Press Record to capture audio.'}
        </span>
      </div>

      {selected ? (
        <SessionDetail
          session={selected}
          tab={tab}
          setTab={setTab}
          running={running}
          onRun={runTransform}
          onBackToList={() => setSelectedId(null)}
          activeText={activeText}
          onCopy={onCopy}
          copied={copied}
          onSaveToLibrary={onSaveToLibrary}
          saved={saved}
          onDelete={() => void removeSession(selected.id)}
          disabled={isBusy}
        />
      ) : (
        <SessionList
          sessions={sessions}
          onOpen={(id) => { setSelectedId(id); setTab('transcript'); setCopied(false); setSaved(false); }}
          onDelete={(id) => void removeSession(id)}
        />
      )}
    </div>
  );
}

function SessionList({ sessions, onOpen, onDelete }: {
  sessions: TranscriptSession[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (sessions.length === 0) {
    return (
      <div className="live-scroll" data-testid="voice-sessions">
        <div className="empty-state">
          <span className="ic" style={{ width: 28, height: 28 }}>{Ic.mic}</span>
          <div className="empty-state-title">Voice Transcriber</div>
          <div className="empty-state-desc">
            Press Record to capture audio. When you stop, it's transcribed and saved as a
            session — then you can summarize it, clean it up, or turn it into meeting notes.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="live-scroll" data-testid="voice-sessions">
      <div className="list-col">
        {sessions.map((s) => (
          <button key={s.id} type="button" className="session-card" onClick={() => onOpen(s.id)} data-testid="voice-session">
            <div className="session-card-main">
              <div className="session-card-title">{s.title}</div>
              <div className="session-card-meta">
                {formatWhen(s.createdAt)} · {formatDuration(s.durationMs)}
                {Object.keys(s.transforms).length > 0 && ` · ${Object.keys(s.transforms).length} transform(s)`}
              </div>
            </div>
            <span
              className="session-card-del"
              role="button"
              tabIndex={0}
              title="Delete session"
              onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onDelete(s.id); } }}
            >
              ×
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SessionDetail({
  session, tab, setTab, running, onRun, onBackToList,
  activeText, onCopy, copied, onSaveToLibrary, saved, onDelete, disabled,
}: {
  session: TranscriptSession;
  tab: Tab;
  setTab: (t: Tab) => void;
  running: TransformKind | null;
  onRun: (k: TransformKind) => void;
  onBackToList: () => void;
  activeText: string;
  onCopy: () => void;
  copied: boolean;
  onSaveToLibrary: () => void;
  saved: boolean;
  onDelete: () => void;
  disabled: boolean;
}) {
  const tabs: Tab[] = ['transcript', ...(Object.keys(session.transforms) as TransformKind[])];
  return (
    <div className="live-scroll" data-testid="voice-detail">
      <div className="session-head">
        <button type="button" className="btn btn-sm" onClick={onBackToList} data-testid="voice-back-list">‹ Sessions</button>
        <div className="session-head-info">
          <div className="session-card-title">{session.title}</div>
          <div className="session-card-meta">{formatWhen(session.createdAt)} · {formatDuration(session.durationMs)}</div>
        </div>
      </div>

      {/* Transform actions. */}
      <div className="transform-actions">
        {TRANSFORMS.map((t) => (
          <button
            key={t.kind}
            type="button"
            className="btn btn-sm"
            disabled={disabled || running !== null}
            onClick={() => onRun(t.kind)}
            data-testid={`voice-run-${t.kind}`}
            title={session.transforms[t.kind] ? `Re-run ${t.label}` : t.label}
          >
            {running === t.kind ? '…' : session.transforms[t.kind] ? `↻ ${t.label}` : t.label}
          </button>
        ))}
      </div>

      {/* Tabs: transcript + each completed transform. */}
      <div className="transform-tabs">
        {tabs.map((tk) => (
          <button
            key={tk}
            type="button"
            className={'transform-tab' + (tab === tk ? ' is-active' : '')}
            onClick={() => setTab(tk)}
            data-testid={`voice-tab-${tk}`}
          >
            {tk === 'transcript' ? 'Transcript' : transformDef(tk).label}
          </button>
        ))}
      </div>

      <div className="transform-body" data-testid="voice-content">{activeText}</div>

      <div className="session-foot">
        <button type="button" className="btn btn-sm" onClick={onCopy} disabled={!activeText} data-testid="voice-copy">
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
        <button type="button" className="btn btn-sm" onClick={onSaveToLibrary} disabled={!activeText} data-testid="voice-library"
          title="Save the current text as a doc in your Library.">
          {saved ? 'Saved ✓' : '+ Library'}
        </button>
        <span className="live-bar-spacer" />
        <button type="button" className="btn btn-sm btn-danger" onClick={onDelete} disabled={disabled} data-testid="voice-delete">
          Delete
        </button>
      </div>
    </div>
  );
}
