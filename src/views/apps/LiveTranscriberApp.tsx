// LiveTranscriberApp — real-time speech-to-text using Gemini Live with
// responseModalities=['TEXT'] so the model doesn't synthesise audio replies.
// We consume only `inputTranscription` events from the server and append them
// to a growing transcript. Save to Library / copy / clear actions on top.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppHeader, appById } from '../AppsView';
import { Ic } from '../../ui/icons';
import { VoiceSession, isVoiceSupported, type VoiceEvent } from '../../voice/liveSession';

interface TranscriptLine {
  /** Wall-clock ms relative to session start. */
  ts: number;
  text: string;
}

const SAVE_TITLE_PREFIX = 'Live transcript';
const SYSTEM_PROMPT =
  'You are a transcription assistant. The user is dictating or recording a meeting. ' +
  'Do not respond, do not summarise, do not add commentary. Just listen.';

export function LiveTranscriberApp({ onBack }: { onBack: () => void }) {
  const app = appById('livescribe');
  const sessionRef = useRef<VoiceSession | null>(null);
  const startedAtRef = useRef<number>(0);
  /** Working buffer for the in-flight user phrase — replaced (not appended)
   *  as the server streams partial transcripts; promoted to a settled line
   *  when `isFinal` arrives. */
  const partialRef = useRef<string>('');
  const [state, setState] = useState<'idle' | 'connecting' | 'live' | 'error'>('idle');
  const [error, setError] = useState<string | undefined>();
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [partial, setPartial] = useState<string>('');
  const [saved, setSaved] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // Auto-scroll the transcript area as new lines come in.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [lines.length, partial]);

  const onEvent = useCallback((e: VoiceEvent) => {
    switch (e.kind) {
      case 'open':
        setState('live');
        break;
      case 'transcript':
        if (e.role !== 'user') return; // ignore model output (we asked for TEXT but it may still emit)
        if (e.isFinal) {
          // Final chunks REPLACE the interim — they contain the full phrase
          // the server settled on, not a delta. Using `partialRef + text`
          // duplicated the prefix.
          const text = e.text.trim();
          partialRef.current = '';
          setPartial('');
          if (text) {
            setLines((prev) => [...prev, { ts: Date.now() - startedAtRef.current, text }]);
          }
        } else {
          partialRef.current = e.text;
          setPartial(e.text);
        }
        break;
      case 'error':
        setError(e.message);
        setState('error');
        break;
      case 'closed':
        // A failing session fires ERROR then CLOSED in quick succession. Don't
        // let the close snap us back to the idle prompt — that wiped the error
        // text before it could be read (the "flash red then default" mystery).
        // Keep the error visible; only a clean close returns to idle.
        setState((s) => (s === 'error' ? 'error' : 'idle'));
        sessionRef.current = null;
        // Promote any in-flight partial as a final line so nothing is lost.
        if (partialRef.current.trim()) {
          const text = partialRef.current.trim();
          partialRef.current = '';
          setPartial('');
          setLines((prev) => [...prev, { ts: Date.now() - startedAtRef.current, text }]);
        }
        break;
      default:
        break;
    }
  }, []);

  const start = useCallback(async () => {
    if (sessionRef.current) return;
    setError(undefined);
    setState('connecting');
    if (lines.length === 0) startedAtRef.current = Date.now();
    const session = new VoiceSession({
      onEvent,
      systemInstruction: SYSTEM_PROMPT,
      responseModalities: 'TEXT',
    });
    sessionRef.current = session;
    try {
      await session.start();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the transcriber.');
      setState('error');
      sessionRef.current = null;
    }
  }, [lines.length, onEvent]);

  const stop = useCallback(async () => {
    const s = sessionRef.current;
    sessionRef.current = null;
    setState('idle');
    if (s) await s.stop();
  }, []);

  const clear = useCallback(() => {
    setLines([]);
    setPartial('');
    partialRef.current = '';
    startedAtRef.current = 0;
    setSaved(false);
    setCopied(false);
  }, []);

  // Cleanup on unmount.
  useEffect(() => () => { void sessionRef.current?.stop(); }, []);

  const fullText = useMemo(() => {
    const out: string[] = [];
    for (const l of lines) out.push(`[${formatStamp(l.ts)}] ${l.text}`);
    return out.join('\n');
  }, [lines]);

  const onCopy = useCallback(async () => {
    if (!fullText) return;
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  }, [fullText]);

  const onSaveToLibrary = useCallback(async () => {
    if (!fullText) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const title = `${SAVE_TITLE_PREFIX} ${stamp}`;
    const content = `# ${title}\n\n${fullText}`;
    try {
      const r = (await chrome.runtime.sendMessage({
        type: 'LIBRARY_INDEX',
        source: 'manual',
        sourceRef: `livescribe-${stamp}`,
        title,
        content,
      })) as { ok: boolean; result: { ok: boolean } } | undefined;
      if (r?.ok && r.result.ok) {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 1800);
      }
    } catch {
      /* ignore */
    }
  }, [fullText]);

  const supported = isVoiceSupported();
  const isOn = state === 'live' || state === 'connecting';
  const isEmpty = lines.length === 0 && !partial;

  return (
    <div className="micro">
      <AppHeader app={app} onBack={onBack} />
      <div className="live-bar">
        <button
          type="button"
          className={'voice-btn' + (isOn ? ' is-on' : '')}
          disabled={!supported}
          onClick={isOn ? () => void stop() : () => void start()}
          data-testid={isOn ? 'live-stop' : 'live-start'}
        >
          <span className="ic">{isOn ? Ic.stop : Ic.mic}</span>
          <span>{isOn ? 'Stop' : 'Record'}</span>
        </button>
        <span className={'voice-state voice-state-' + state}>
          {!supported
            ? 'Live transcription unavailable in this context.'
            : state === 'connecting'
              ? 'Connecting…'
              : state === 'live'
                ? '● Listening'
                : state === 'error'
                  ? error ?? 'Error'
                  : isEmpty ? 'Press Record to start.' : 'Idle.'}
        </span>
        <span className="live-bar-spacer" />
        <button
          type="button"
          className="btn btn-sm"
          onClick={onCopy}
          disabled={!fullText}
          data-testid="live-copy"
        >
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={onSaveToLibrary}
          disabled={!fullText}
          data-testid="live-save"
          title="Save the transcript as a doc in your Library."
        >
          {saved ? 'Saved ✓' : '+ Library'}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={clear}
          disabled={isEmpty || isOn}
          data-testid="live-clear"
        >
          Clear
        </button>
      </div>
      <div className="live-scroll" ref={scrollRef} data-testid="live-transcript">
        {isEmpty && state !== 'live' ? (
          <div className="empty-state">
            <span className="ic" style={{ width: 28, height: 28 }}>{Ic.mic}</span>
            <div className="empty-state-title">Live Transcriber</div>
            <div className="empty-state-desc">
              Press Record to start a Gemini Live streaming transcription. Buddy is told
              to just listen — no replies, no summaries. Save the result to your Library
              when you're done.
            </div>
          </div>
        ) : (
          <div className="live-body">
            {lines.map((l, i) => (
              <div key={i} className="live-line">
                <span className="live-stamp">{formatStamp(l.ts)}</span>
                <span className="live-text">{l.text}</span>
              </div>
            ))}
            {partial && (
              <div className="live-line live-line-partial">
                <span className="live-stamp">…</span>
                <span className="live-text">{partial}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Format ms relative to session start as HH:MM:SS or MM:SS. */
function formatStamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
