import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AppHeader, appById } from '../AppsView';
import { Ic } from '../../ui/icons';
import {
  consoleController,
  countByLevel,
  type LogEntry,
  type LogLevel,
} from '../../console';
import { matchErrors } from '../../console/errorPatterns';
import { analyzeErrorsAI, type ErrorAnalysis } from '../../console/errorAnalysis';
import { useResolvedModelId } from '../../llm/modelPref';
import { ErrorAnalysisCard } from './console/ErrorAnalysisCard';
import {
  ErrorsPanel,
  NetworkPanel,
  VitalsPanel,
  SecurityPanel,
  StoragePanel,
  SensitivePanel,
  TechStackPanel,
  A11yPanel,
  SeoPanel,
  AeoPanel,
  HealthPanel,
  type OnHandoff,
} from './consolePanels';
import { ConsoleChat } from './console/ConsoleChat';
import { downloadText } from './console/shared';

type Filter = 'all' | LogLevel;
type Mode =
  | 'health'
  | 'console'
  | 'errors'
  | 'network'
  | 'vitals'
  | 'security'
  | 'storage'
  | 'sensitive'
  | 'tech'
  | 'a11y'
  | 'seo'
  | 'aeo';
const TABS: Filter[] = ['all', 'error', 'warn', 'log', 'net'];
const MODES: { id: Mode; label: string }[] = [
  { id: 'health', label: 'Health' },
  { id: 'console', label: 'Console' },
  { id: 'errors', label: 'Errors' },
  { id: 'network', label: 'Network' },
  { id: 'vitals', label: 'Vitals' },
  { id: 'security', label: 'Security' },
  { id: 'storage', label: 'Storage' },
  { id: 'sensitive', label: 'Secrets' },
  { id: 'tech', label: 'Stack' },
  { id: 'a11y', label: 'A11y' },
  { id: 'seo', label: 'SEO' },
  { id: 'aeo', label: 'AEO' },
];

/** A signature of the captured error/warning set — changes only when the errors
 *  (or counts) change, so auto-analysis re-runs on real changes, not polls. */
const errSig = (errs: ReadonlyArray<LogEntry>): string =>
  errs.map((e) => `${e.level}:${e.text.slice(0, 60)}:${e.count}`).join('|');

export function ConsoleApp({
  onBack,
  onHandoff,
}: {
  onBack: () => void;
  onHandoff?: OnHandoff;
}) {
  const app = appById('console');
  const controllerRef = useRef(consoleController());

  const [mode, setMode] = useState<Mode>('health');
  const [filter, setFilter] = useState<Filter>('all');
  const [capturing, setCapturing] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [artifact, setArtifact] = useState<ErrorAnalysis | undefined>();
  const [analyzing, setAnalyzing] = useState(false);
  const [aiError, setAiError] = useState<string | undefined>();
  const [analyzedSig, setAnalyzedSig] = useState<string | undefined>();
  const [autoOff, setAutoOff] = useState(false);
  const autoTimer = useRef<number | undefined>(undefined);
  const scheduledSig = useRef<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [showChat, setShowChat] = useState(false);
  const modelId = useResolvedModelId();

  // While capturing, poll the controller snapshot so the live list updates.
  useEffect(() => {
    if (!capturing) return;
    const id = setInterval(() => {
      setLogs(controllerRef.current?.snapshot() ?? []);
    }, 600);
    return () => clearInterval(id);
  }, [capturing]);

  // Detach the debugger if the panel unmounts mid-capture. We INTENTIONALLY
  // read controllerRef.current at cleanup time, not at mount — the controller
  // is created later inside start(), so a snapshot-at-mount pattern would
  // miss it. The ref is a stable instance variable; reading .current at
  // cleanup is the documented React pattern for "latest mutable value."
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    return () => {
      void controllerRef.current?.stop();
    };
  }, []);

  const start = useCallback(async () => {
    setError(undefined);
    try {
      await controllerRef.current?.start();
      setCapturing(true);
      setLogs(controllerRef.current?.snapshot() ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start capturing.');
    }
  }, []);

  const stop = useCallback(async () => {
    await controllerRef.current?.stop();
    setLogs(controllerRef.current?.snapshot() ?? []);
    setCapturing(false);
  }, []);

  const clear = useCallback(() => {
    controllerRef.current?.clear();
    setLogs([]);
    setArtifact(undefined);
    setAnalyzedSig(undefined);
    setAutoOff(false);
    scheduledSig.current = undefined;
  }, []);

  // Build the SAME rich artifact the Errors tab shows, from the live stream:
  // pattern-match the logs for a head-start + pass the raw error/warning lines
  // to the model. Works even on errors no pattern recognizes (the model reads
  // the raw lines), e.g. a 403 from a third-party embed.
  const analyze = useCallback(async () => {
    const snap = logs;
    const errs = snap.filter((l) => l.level === 'error' || l.level === 'warn');
    if (errs.length === 0) return;
    const sig = errSig(errs);
    setAnalyzing(true);
    setAiError(undefined);
    try {
      const matches = matchErrors(snap.map((l) => l.text));
      const result = await analyzeErrorsAI({ matches, logs: snap }, modelId);
      setArtifact(result);
      setAnalyzedSig(sig);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Analysis failed. Try again.');
      setAutoOff(true); // stop auto-retrying (e.g. no API key); the button re-enables
    } finally {
      setAnalyzing(false);
    }
  }, [logs, modelId]);

  // Auto-generate the artifact the moment a (new) error-set is captured, so it
  // appears right away rather than behind a click. The timer is armed ONCE per
  // distinct error-set (via scheduledSig) so the 600ms snapshot poll can't keep
  // resetting the debounce — it just won't re-arm for an unchanged error-set.
  useEffect(() => {
    if (autoOff || analyzing || !capturing) return;
    const errs = logs.filter((l) => l.level === 'error' || l.level === 'warn');
    if (errs.length === 0) return;
    const sig = errSig(errs);
    if (sig === analyzedSig || sig === scheduledSig.current) return;
    scheduledSig.current = sig;
    window.clearTimeout(autoTimer.current);
    autoTimer.current = window.setTimeout(() => { scheduledSig.current = undefined; void analyze(); }, 700);
  }, [logs, analyzedSig, autoOff, analyzing, capturing, analyze]);

  const counts = useMemo(() => countByLevel(logs), [logs]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter(
      (l) => (filter === 'all' || l.level === filter) && (!q || l.text.toLowerCase().includes(q) || (l.source ?? '').toLowerCase().includes(q)),
    );
  }, [logs, filter, search]);

  const exportLogs = useCallback(() => {
    const text = logs
      .map((l) => `[${l.level.toUpperCase()}]${l.count > 1 ? ` x${l.count}` : ''} ${l.text}${l.source ? `  @ ${l.source}` : ''}`)
      .join('\n');
    downloadText('console-log.txt', text || '(no console activity)');
  }, [logs]);

  const countFor = (k: Filter): number =>
    k === 'all' ? logs.reduce((n, l) => n + l.count, 0) : counts[k];

  const hasLogs = logs.length > 0;

  return (
    <div className="micro">
      <AppHeader app={app} onBack={onBack} />

      <div className="ci-modes" role="tablist">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            className={'ci-mode' + (mode === m.id ? ' is-on' : '')}
            onClick={() => setMode(m.id)}
            data-testid={`ci-mode-${m.id}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'errors' && <ErrorsPanel capturing={capturing} onHandoff={onHandoff} />}
      {mode === 'network' && <NetworkPanel capturing={capturing} />}
      {mode === 'vitals' && <VitalsPanel />}
      {mode === 'security' && <SecurityPanel onHandoff={onHandoff} />}
      {mode === 'storage' && <StoragePanel />}
      {mode === 'sensitive' && <SensitivePanel />}
      {mode === 'tech' && <TechStackPanel />}
      {mode === 'a11y' && <A11yPanel onHandoff={onHandoff} />}
      {mode === 'seo' && <SeoPanel onHandoff={onHandoff} />}
      {mode === 'aeo' && <AeoPanel onHandoff={onHandoff} />}
      {mode === 'health' && <HealthPanel onHandoff={onHandoff} />}

      {mode === 'console' && (
        <>
      <div className="console-bar">
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            className={'console-chip' + (filter === k ? ' is-on' : '')}
            onClick={() => setFilter(k)}
          >
            <span className={'console-chip-dot dot-' + k} />
            <span className="console-chip-l">{k}</span>
            <span className="console-chip-c">{countFor(k)}</span>
          </button>
        ))}
        <span className="console-spacer" />
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={capturing ? stop : start}
        >
          {capturing ? 'Stop' : 'Start'}
        </button>
        <button type="button" className="console-clear" onClick={exportLogs} disabled={!hasLogs} data-testid="ci-console-export">
          Export
        </button>
        <button type="button" className="console-clear" onClick={clear} disabled={!hasLogs}>
          Clear
        </button>
      </div>

      <div className="console-search">
        <input
          type="text"
          className="cb-input"
          placeholder="Filter logs by text or source…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="ci-console-search"
        />
      </div>

      {capturing && (
        <div className="console-notice" role="status" style={noticeStyle}>
          <span className="ic" style={{ width: 14, height: 14, flex: '0 0 auto' }}>{Ic.console}</span>
          Capturing via DevTools Protocol — Chrome shows an “extension is debugging this browser”
          banner while active.
        </div>
      )}

      {error && (
        <div className="console-notice" role="alert" style={{ ...noticeStyle, ...errNoticeStyle }}>
          {error}
        </div>
      )}

      <div className="console-list">
        {hasLogs ? (
          shown.map((l, i) => (
            <div
              key={`${l.level}-${i}-${l.text}`}
              className={
                'console-row' +
                (l.level === 'error' ? ' console-error' : l.level === 'warn' ? ' console-warn' : '')
              }
            >
              <span className={'console-lvl console-lvl-' + l.level}>{l.level}</span>
              <span className="console-text" title={l.text}>{l.text}</span>
              <span className="console-src" title={l.source}>{shortSource(l.source)}</span>
              {l.count > 1 ? <span className="console-count">{l.count}</span> : <span />}
            </div>
          ))
        ) : (
          <div className="empty-state">
            <span className="ic" style={{ width: 28, height: 28 }}>{Ic.console}</span>
            <div className="empty-state-title">No console activity yet</div>
            <div className="empty-state-desc">
              Start capturing to stream console logs and network calls from the current tab. Buddy
              will flag and explain errors.
            </div>
            <button type="button" className="btn btn-primary" onClick={start}>
              Start capturing
            </button>
          </div>
        )}
      </div>

      {(hasLogs || artifact) && (
        <div className="console-ai">
          {/* The full AI Error Analysis artifact — auto-generated from the live
              stream (same card as the Errors tab), not a one-line summary. */}
          {analyzing && !artifact && (
            <div className="console-ai-hd">
              <span className="ic" style={{ width: 14, height: 14 }}>{Ic.sparkle}</span>
              Analyzing errors…
            </div>
          )}
          {artifact && <ErrorAnalysisCard analysis={artifact} onDismiss={() => { setArtifact(undefined); setAutoOff(true); }} />}
          {!artifact && !analyzing && (
            <div className="console-ai-body" data-testid="ci-console-ai-hint">
              {counts.error > 0
                ? `${counts.error} error(s) captured — generating the analysis…`
                : 'No errors yet — capture some activity and Buddy will analyze it here.'}
            </div>
          )}
          {aiError && <div className="ci-cchat-err">{aiError}</div>}
          <div className="console-ai-actions">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => { setAutoOff(false); void analyze(); }}
              disabled={analyzing || counts.error + counts.warn === 0}
              data-testid="ci-console-analyze"
            >
              {analyzing ? 'Analyzing…' : artifact ? '✨ Re-analyze' : '✨ Analyze errors'}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setShowChat((s) => !s)}
              disabled={!hasLogs}
              data-testid="ci-console-chat-toggle"
            >
              {showChat ? 'Hide chat' : 'Chat with console'}
            </button>
          </div>
          {showChat && hasLogs && <ConsoleChat logs={logs} />}
        </div>
      )}
        </>
      )}
    </div>
  );
}

const noticeStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 14px',
  fontSize: 11.5,
  lineHeight: 1.4,
  color: 'var(--panel-muted)',
  background: 'var(--panel-elev)',
  borderBottom: '1px solid var(--panel-border-soft)',
};

const errNoticeStyle: CSSProperties = {
  color: '#B91C1C',
  background: 'color-mix(in srgb, #EF4444 8%, transparent)',
};

/** Compact a source URL to "host…/lastSegment" for the tight source column. */
function shortSource(source: string | undefined): string {
  if (!source) return '';
  try {
    const u = new URL(source);
    const last = u.pathname.split('/').filter(Boolean).pop() ?? '';
    return last ? `${u.host}/${last}` : u.host;
  } catch {
    return source;
  }
}
