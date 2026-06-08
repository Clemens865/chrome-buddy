// ErrorsPanel — console capture pattern-matched against the 27 known error
// shapes (errorPatterns.ts). Each match is a severity-pilled card with a
// per-card "Copy" button + a top-bar "Copy fix prompt" + "Send to Buddy".

import { useCallback, useEffect, useState } from 'react';
import { Ic } from '../../../ui/icons';
import type { ErrorMatch } from '../../../console/errorPatterns';
import type { TechMatch } from '../../../console/techStack';
import type { LogEntry } from '../../../console/capture';
import {
  buildFixPrompt,
  buildSingleFixPrompt,
  buildBuddyChatPrompt,
  type FixPromptContext,
} from '../../../console/fixPrompt';
import { analyzeErrorsAI, type ErrorAnalysis } from '../../../console/errorAnalysis';
import { useResolvedModelId } from '../../../llm/modelPref';
import { runTool, copyToClipboard, errNoticeStyle, noticeStyle, type OnHandoff } from './shared';
import { ErrorAnalysisCard } from './ErrorAnalysisCard';

interface AnalyzeData {
  scanned: number;
  matchCount: number;
  matches: ErrorMatch[];
  hint?: string;
}

export function ErrorsPanel({
  capturing,
  onHandoff,
}: {
  capturing: boolean;
  onHandoff?: OnHandoff;
}) {
  const [data, setData] = useState<AnalyzeData | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [copied, setCopied] = useState<Record<string, boolean>>({});
  const [techContext, setTechContext] = useState<FixPromptContext | undefined>();
  // AI deep-analysis (on demand, model-backed) — distinct from the offline
  // pattern matches above. Holds the structured artifact + its own busy/error.
  const [analysis, setAnalysis] = useState<ErrorAnalysis | undefined>();
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | undefined>();
  const modelId = useResolvedModelId();

  const run = useCallback(async (force = false) => {
    setBusy(true);
    setError(undefined);
    const r = await runTool<AnalyzeData>('analyze_errors', { limit: 200 }, { force });
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else setData(r.data);
  }, []);

  useEffect(() => {
    if (!capturing) return;
    run();
    const id = setInterval(run, 1500);
    return () => clearInterval(id);
  }, [capturing, run]);

  // Fetch detected tech stack once so the IDE prompt can mention the framework.
  useEffect(() => {
    let active = true;
    void (async () => {
      const r = await runTool<{ url: string; matches: TechMatch[] }>('detect_tech_stack');
      if (!active) return;
      if (r.ok) {
        setTechContext({ url: r.data.url, techStack: r.data.matches.map((m) => m.name) });
      }
    })();
    return () => { active = false; };
  }, []);

  const flash = (key: string) => {
    setCopied((s) => ({ ...s, [key]: true }));
    window.setTimeout(() => setCopied((s) => ({ ...s, [key]: false })), 1400);
  };

  const copyAll = async () => {
    if (!data) return;
    const md = buildFixPrompt({ matches: data.matches, context: techContext });
    if (await copyToClipboard(md)) flash('all');
  };

  const copyOne = async (m: ErrorMatch, idx: number) => {
    const md = buildSingleFixPrompt(m, techContext);
    if (await copyToClipboard(md)) flash(String(idx));
  };

  const sendToBuddy = () => {
    if (!data || !onHandoff) return;
    const prompt = buildBuddyChatPrompt({ matches: data.matches, context: techContext });
    onHandoff({ prompt, mode: 'agent' });
  };

  // On-demand model-backed analysis: pull the raw console snapshot (for stack
  // traces / source files the pattern matcher discards) and pass it + the
  // matches + tech context to the model, which returns the structured artifact.
  const runAiAnalysis = async () => {
    if (!data) return;
    setAiBusy(true);
    setAiError(undefined);
    try {
      const r = await runTool<{ entries: LogEntry[] }>('read_console', { level: 'all', limit: 200 });
      const logs = r.ok ? r.data.entries : undefined;
      const result = await analyzeErrorsAI(
        { matches: data.matches, logs, context: techContext },
        modelId,
      );
      setAnalysis(result);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Analysis failed. Try again.');
    } finally {
      setAiBusy(false);
    }
  };

  const hasMatches = !!data && data.matches.length > 0;

  return (
    <div className="ci-panel" data-testid="ci-panel-errors">
      <div className="ci-panel-bar">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => run(true)} disabled={busy}>
          {busy ? 'Scanning…' : 'Scan errors'}
        </button>
        {hasMatches && (
          <>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={runAiAnalysis}
              disabled={aiBusy}
              data-testid="ci-errors-ai-analyze"
              title="Ask the model for a deep read: root cause, fix plan, code + a ready-to-paste AI prompt."
            >
              {aiBusy ? 'Analyzing…' : '✨ AI Analysis'}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={copyAll}
              data-testid="ci-errors-copy-all"
              title="Copy a paste-ready fix prompt for your coding IDE (Cursor, Claude Code, …)."
            >
              {copied.all ? 'Copied ✓' : 'Copy fix prompt'}
            </button>
            {onHandoff && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={sendToBuddy}
                data-testid="ci-errors-send-buddy"
                title="Open a Buddy chat that uses list_files + read_file + write_file to find and fix the code in your root folder."
              >
                Send to Buddy
              </button>
            )}
          </>
        )}
        {data && (
          <span className="ci-panel-meta">
            {data.matchCount} matched · {data.scanned} scanned
          </span>
        )}
      </div>
      {error && <div className="console-notice" role="alert" style={errNoticeStyle}>{error}</div>}
      {aiError && <div className="console-notice" role="alert" style={errNoticeStyle}>{aiError}</div>}
      {data?.hint && <div className="console-notice" role="status" style={noticeStyle}>{data.hint}</div>}
      {analysis && <ErrorAnalysisCard analysis={analysis} onDismiss={() => setAnalysis(undefined)} />}
      {hasMatches ? (
        <div className="ci-cards">
          {data!.matches.map((m, i) => (
            <div key={i} className={'ci-card ci-sev-' + m.severity}>
              <div className="ci-card-hd">
                <span className={'ci-sev-pill ci-sev-pill-' + m.severity}>{m.severity}</span>
                <span className="ci-card-cat">{m.framework ? `${m.framework} · ${m.category}` : m.category}</span>
                {m.count > 1 && <span className="ci-card-count">×{m.count}</span>}
                <button
                  type="button"
                  className="ci-card-copy"
                  onClick={() => copyOne(m, i)}
                  data-testid={`ci-errors-copy-${i}`}
                  title="Copy a fix prompt for just this error."
                >
                  {copied[String(i)] ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
              <div className="ci-card-desc">{m.description}</div>
              <div className="ci-card-fix">
                <strong>Fix:</strong> {m.suggestion}
              </div>
              {m.docUrl && (
                <a href={m.docUrl} target="_blank" rel="noreferrer" className="ci-card-doc">
                  Docs ↗
                </a>
              )}
            </div>
          ))}
        </div>
      ) : (
        data && !data.hint && (
          <div className="empty-state">
            <span className="ic" style={{ width: 28, height: 28 }}>{Ic.console}</span>
            <div className="empty-state-title">No known patterns detected</div>
            <div className="empty-state-desc">Capture some console activity, then scan again.</div>
          </div>
        )
      )}
    </div>
  );
}
