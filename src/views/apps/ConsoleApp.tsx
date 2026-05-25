import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AppHeader, appById } from '../AppsView';
import { Ic } from '../../ui/icons';
import {
  analyzeLogs,
  consoleController,
  countByLevel,
  type AnalysisResult,
  type LogEntry,
  type LogLevel,
} from '../../console';
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
  type OnHandoff,
} from './consolePanels';

type Filter = 'all' | LogLevel;
type Mode =
  | 'console'
  | 'errors'
  | 'network'
  | 'vitals'
  | 'security'
  | 'storage'
  | 'sensitive'
  | 'tech'
  | 'a11y'
  | 'seo';
const TABS: Filter[] = ['all', 'error', 'warn', 'log', 'net'];
const MODES: { id: Mode; label: string }[] = [
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
];

export function ConsoleApp({
  onBack,
  onHandoff,
}: {
  onBack: () => void;
  onHandoff?: OnHandoff;
}) {
  const app = appById('console');
  const controllerRef = useRef(consoleController());

  const [mode, setMode] = useState<Mode>('console');
  const [filter, setFilter] = useState<Filter>('all');
  const [capturing, setCapturing] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [analysis, setAnalysis] = useState<AnalysisResult | undefined>();
  const [analyzing, setAnalyzing] = useState(false);

  // While capturing, poll the controller snapshot so the live list updates.
  useEffect(() => {
    if (!capturing) return;
    const id = setInterval(() => {
      setLogs(controllerRef.current?.snapshot() ?? []);
    }, 600);
    return () => clearInterval(id);
  }, [capturing]);

  // Detach the debugger if the panel unmounts mid-capture.
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
    setAnalysis(undefined);
  }, []);

  const analyze = useCallback(async () => {
    setAnalyzing(true);
    setError(undefined);
    try {
      setAnalysis(await analyzeLogs(controllerRef.current?.snapshot() ?? []));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed.');
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const counts = useMemo(() => countByLevel(logs), [logs]);
  const shown = useMemo(
    () => (filter === 'all' ? logs : logs.filter((l) => l.level === filter)),
    [logs, filter],
  );

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
        <button type="button" className="console-clear" onClick={clear} disabled={!hasLogs}>
          Clear
        </button>
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

      {(hasLogs || analysis) && (
        <div className="console-ai">
          <div className="console-ai-hd">
            <span className="ic" style={{ width: 14, height: 14 }}>{Ic.sparkle}</span>
            Buddy analysis
          </div>
          {analysis ? (
            <div className="console-ai-body">{analysis.explanation}</div>
          ) : (
            <div className="console-ai-body">
              {counts.error > 0
                ? `${counts.error} error(s) captured. Ask Buddy to explain the most frequent one.`
                : 'No errors yet — capture some activity, then let Buddy review it.'}
            </div>
          )}
          <div className="console-ai-actions">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={analyze}
              disabled={analyzing || !hasLogs}
            >
              {analyzing ? 'Analyzing…' : 'Analyze with Buddy'}
            </button>
          </div>
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
