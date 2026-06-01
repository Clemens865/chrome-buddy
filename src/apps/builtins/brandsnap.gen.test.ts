// Generator + guard for the BrandSnap catalog entry. Validates the app through
// the SAME re-validation that runs on install (parseAppBundle), then emits the
// catalog bundle JSON to docs/catalog-seed so the file can't drift from source.
import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAppBundle } from '../appBundle';
import { BRANDSNAP_APP } from './brandsnap';

describe('BrandSnap catalog bundle', () => {
  const bundle = { schemaVersion: 2, apps: [BRANDSNAP_APP] };

  it('survives install re-validation (parseAppBundle) as a Tier-3 app', () => {
    const review = parseAppBundle(JSON.stringify(bundle));
    expect(review.apps).toHaveLength(1);
    expect(review.dropped).toBe(0);
    expect(review.apps[0]).toMatchObject({ tier: 3, name: 'BrandSnap AI' });
    expect(review.apps[0].permissions?.sort()).toEqual(['download', 'image']);
    // No <script> / inline handlers survive the sanitizer.
    expect(review.apps[0].html ?? '').not.toMatch(/<script|onclick=/i);
  });

  it('emits docs/catalog-seed/apps/brandsnap-ai.json', () => {
    const out = join(process.cwd(), 'docs/catalog-seed/apps/brandsnap-ai.json');
    writeFileSync(out, JSON.stringify(bundle, null, 2) + '\n');
    expect(parseAppBundle(JSON.stringify(bundle)).apps).toHaveLength(1);
  });
});
