// ErrorAnalysisCard — renders the structured AI Error Analysis artifact:
// Summary · Root Cause · numbered Suggested Fixes · Suggested Code (copyable) ·
// Ready-for-AI prompt (copyable) · Files to Check · Search For. Mirrors the
// MicroLabs console-monitor output shape, themed with the cb/ci design tokens.

import { useState } from 'react';
import type { ErrorAnalysis } from '../../../console/errorAnalysis';
import { copyToClipboard } from './shared';

export function ErrorAnalysisCard({
  analysis,
  onDismiss,
}: {
  analysis: ErrorAnalysis;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const flash = (key: string) => {
    setCopied(key);
    window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1400);
  };
  const copy = async (text: string, key: string) => {
    if (await copyToClipboard(text)) flash(key);
  };

  return (
    <div className="ci-aia" data-testid="ci-errors-ai-analysis">
      <div className="ci-aia-hd">
        <span className="ci-aia-title">✨ AI Error Analysis</span>
        <button type="button" className="ci-card-copy" onClick={onDismiss} data-testid="ci-errors-ai-hide">
          Hide
        </button>
      </div>

      <div className="ci-aia-body">
        {analysis.summary && (
          <section>
            <h4 className="ci-aia-h">Summary</h4>
            <p className="ci-aia-p">{analysis.summary}</p>
          </section>
        )}

        {analysis.rootCause && (
          <section className="ci-aia-rootcause">
            <h4 className="ci-aia-h ci-aia-h-danger">Root Cause</h4>
            <p className="ci-aia-p">{analysis.rootCause}</p>
          </section>
        )}

        {analysis.suggestedFixes.length > 0 && (
          <section>
            <h4 className="ci-aia-h">Suggested Fixes</h4>
            <ol className="ci-aia-fixes">
              {analysis.suggestedFixes.map((fix, i) => (
                <li key={i} className="ci-aia-fix">
                  <span className="ci-aia-num">{i + 1}</span>
                  <span className="ci-aia-fix-text">{fix}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {analysis.suggestedCode && (
          <section>
            <div className="ci-aia-h-row">
              <h4 className="ci-aia-h">Suggested Code</h4>
              <button
                type="button"
                className="ci-card-copy"
                onClick={() => copy(analysis.suggestedCode ?? '', 'code')}
                data-testid="ci-errors-ai-copy-code"
              >
                {copied === 'code' ? 'Copied ✓' : 'Copy'}
              </button>
            </div>
            <pre className="ci-aia-code">{analysis.suggestedCode}</pre>
          </section>
        )}

        {analysis.aiPrompt && (
          <section className="ci-aia-prompt">
            <div className="ci-aia-h-row">
              <h4 className="ci-aia-h ci-aia-h-accent">Ready for AI Assistant</h4>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => copy(analysis.aiPrompt, 'prompt')}
                data-testid="ci-errors-ai-copy-prompt"
              >
                {copied === 'prompt' ? 'Copied ✓' : 'Copy Prompt'}
              </button>
            </div>
            <p className="ci-aia-hint">Paste this into Claude, Cursor, Copilot, or any AI coding assistant:</p>
            <div className="ci-aia-promptbox">{analysis.aiPrompt}</div>
          </section>
        )}

        {(analysis.filesToCheck.length > 0 || analysis.searchTerms.length > 0) && (
          <div className="ci-aia-grid">
            {analysis.filesToCheck.length > 0 && (
              <section className="ci-aia-tile">
                <h4 className="ci-aia-h-sm">Files to Check</h4>
                {analysis.filesToCheck.map((f, i) => (
                  <div key={i} className="ci-aia-file">{f}</div>
                ))}
              </section>
            )}
            {analysis.searchTerms.length > 0 && (
              <section className="ci-aia-tile">
                <h4 className="ci-aia-h-sm">Search For</h4>
                {analysis.searchTerms.map((t, i) => (
                  <div key={i} className="ci-aia-term">&ldquo;{t}&rdquo;</div>
                ))}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
