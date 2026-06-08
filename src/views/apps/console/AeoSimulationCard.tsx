// AeoSimulationCard — renders the "Ask an AI about this page" result: the answer
// an engine would give, the facts it can cite, and the gaps that make it unsure.
// This shows the user exactly what an answer engine extracts (and misses).

import { useState } from 'react';
import type { AeoSimulation } from '../../../console/aeoSimulation';
import { copyToClipboard } from './shared';

export function AeoSimulationCard({
  sim,
  onDismiss,
}: {
  sim: AeoSimulation;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyAll = async () => {
    const text = [
      'Answer: ' + sim.answer,
      '',
      'Citable facts:',
      ...sim.citableFacts.map((f) => '- ' + f),
      '',
      'Gaps / ambiguities:',
      ...sim.gaps.map((g) => '- ' + g),
    ].join('\n');
    if (await copyToClipboard(text)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    }
  };

  return (
    <div className="ci-aia" data-testid="ci-aeo-sim">
      <div className="ci-aia-hd">
        <span className="ci-aia-title">🔎 How an AI answer engine reads this page</span>
        <button type="button" className="ci-card-copy" onClick={copyAll} data-testid="ci-aeo-sim-copy">
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
        <button type="button" className="ci-card-copy" onClick={onDismiss} data-testid="ci-aeo-sim-hide">
          Hide
        </button>
      </div>
      <div className="ci-aia-body">
        <section>
          <h4 className="ci-aia-h ci-aia-h-accent">Its answer</h4>
          <p className="ci-aia-p">{sim.answer}</p>
        </section>
        {sim.citableFacts.length > 0 && (
          <section>
            <h4 className="ci-aia-h">Facts it can cite</h4>
            <ul className="ci-aeo-list ci-aeo-good">
              {sim.citableFacts.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </section>
        )}
        {sim.gaps.length > 0 && (
          <section>
            <h4 className="ci-aia-h ci-aia-h-danger">Gaps that make it unsure</h4>
            <ul className="ci-aeo-list ci-aeo-gap">
              {sim.gaps.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
