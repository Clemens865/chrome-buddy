// SEO audit. Given a structural probe of the page <head> + key elements,
// return a severity-sorted list of findings with concrete fix suggestions.
// Pure — no chrome, no I/O — fully unit-testable.

export type SeoSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface SeoSignal {
  /** document.title text. */
  title?: string;
  /** Value of <meta name="description" content="…">. */
  metaDescription?: string;
  /** Value of <meta name="viewport" content="…">. */
  metaViewport?: string;
  /** Value of <meta name="robots" content="…">. */
  metaRobots?: string;
  /** Value of <link rel="canonical" href="…">. */
  canonical?: string;
  /** Open Graph keys with their content values. */
  openGraph: Readonly<Record<string, string>>;
  /** Twitter Card keys with their content values. */
  twitterCard: Readonly<Record<string, string>>;
  /** Number of <h1> elements on the page. */
  h1Count: number;
  /** Text of the first <h1> (or empty when none). */
  h1Text?: string;
  /** Number of <img> elements without an alt attribute. */
  imgsMissingAlt: number;
  /** Whether any <script type="application/ld+json"> blocks parsed as valid JSON. */
  structuredDataBlocks: number;
  /** Whether the structured data parses to an array/object (any block valid). */
  structuredDataValid: boolean;
  /** <html lang="…"> attribute. */
  htmlLang?: string;
  /** Whether the URL is https. */
  isHttps: boolean;
}

export interface SeoIssue {
  id: string;
  severity: SeoSeverity;
  rule: string;
  description: string;
  suggestion: string;
  /** Optional measurement that triggered the rule (e.g. "12 chars"). */
  detail?: string;
}

export interface SeoReport {
  /** 0–100 score, computed from severity-weighted issues. */
  score: number;
  issues: SeoIssue[];
  /** Echo of the structural facts so the panel can render summary chips. */
  facts: {
    titleLength: number;
    descriptionLength: number;
    canonical?: string;
    ogKeys: number;
    twitterKeys: number;
    structuredData: number;
  };
}

const SEVERITY_WEIGHT: Record<SeoSeverity, number> = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 3,
};

/** Run the SEO ruleset against a signal. Pure. */
export function analyzeSeo(s: SeoSignal): SeoReport {
  const issues: SeoIssue[] = [];

  // 1. <title> — must be present and 30-60 characters for typical search snippets.
  const titleLength = (s.title ?? '').length;
  if (!s.title?.trim()) {
    issues.push({
      id: 'title-missing',
      severity: 'critical',
      rule: 'Page title',
      description: 'The <title> element is missing or empty.',
      suggestion: 'Add a descriptive 30-60 char <title> in the document <head>.',
    });
  } else if (titleLength < 30) {
    issues.push({
      id: 'title-short',
      severity: 'medium',
      rule: 'Page title',
      description: 'The <title> is shorter than 30 characters.',
      suggestion: 'Expand the title to 30-60 chars so it reads as a useful search snippet.',
      detail: `${titleLength} chars`,
    });
  } else if (titleLength > 60) {
    issues.push({
      id: 'title-long',
      severity: 'low',
      rule: 'Page title',
      description: 'The <title> is longer than 60 characters and will be truncated in search results.',
      suggestion: 'Trim the title to ≤60 chars; put the most important words first.',
      detail: `${titleLength} chars`,
    });
  }

  // 2. <meta name="description"> — must be present and 50-160 characters.
  const descLength = (s.metaDescription ?? '').length;
  if (!s.metaDescription?.trim()) {
    issues.push({
      id: 'meta-description-missing',
      severity: 'high',
      rule: 'Meta description',
      description: 'No <meta name="description"> tag — search engines will synthesize one.',
      suggestion: 'Add a unique 50-160 char description that summarises the page.',
    });
  } else if (descLength < 50) {
    issues.push({
      id: 'meta-description-short',
      severity: 'low',
      rule: 'Meta description',
      description: 'Meta description is shorter than 50 characters.',
      suggestion: 'Expand the description so it forms a complete snippet.',
      detail: `${descLength} chars`,
    });
  } else if (descLength > 160) {
    issues.push({
      id: 'meta-description-long',
      severity: 'low',
      rule: 'Meta description',
      description: 'Meta description exceeds 160 characters and will be truncated.',
      suggestion: 'Trim the description to ≤160 chars; put the lead in the first 120 chars.',
      detail: `${descLength} chars`,
    });
  }

  // 3. <meta name="viewport"> — required for mobile-friendly rendering.
  if (!s.metaViewport) {
    issues.push({
      id: 'viewport-missing',
      severity: 'high',
      rule: 'Mobile viewport',
      description: 'No <meta name="viewport"> tag — the page won\'t render correctly on mobile.',
      suggestion: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
    });
  }

  // 4. <link rel="canonical"> — strongly recommended.
  if (!s.canonical) {
    issues.push({
      id: 'canonical-missing',
      severity: 'medium',
      rule: 'Canonical URL',
      description: 'No <link rel="canonical"> tag — duplicate-content signals are weaker.',
      suggestion: 'Add <link rel="canonical" href="…"> pointing to the preferred URL of this page.',
    });
  }

  // 5. Open Graph — strongly recommended for social previews.
  const ogKeys = Object.keys(s.openGraph).length;
  const ogRequired = ['og:title', 'og:description', 'og:image', 'og:url'];
  const ogMissing = ogRequired.filter((k) => !s.openGraph[k]);
  if (ogKeys === 0) {
    issues.push({
      id: 'og-missing',
      severity: 'medium',
      rule: 'Open Graph',
      description: 'No Open Graph tags — social shares will use a generic preview.',
      suggestion: `Add ${ogRequired.map((k) => '<meta property="' + k + '" content="…">').join(' / ')}.`,
    });
  } else if (ogMissing.length > 0) {
    issues.push({
      id: 'og-incomplete',
      severity: 'low',
      rule: 'Open Graph',
      description: `Open Graph is missing ${ogMissing.join(', ')}.`,
      suggestion: `Add the missing keys so Facebook / LinkedIn / Slack render rich previews.`,
    });
  }

  // 6. Twitter Card — best-effort.
  if (Object.keys(s.twitterCard).length === 0) {
    issues.push({
      id: 'twitter-card-missing',
      severity: 'low',
      rule: 'Twitter Card',
      description: 'No <meta name="twitter:card"> — Twitter / X falls back to the OG image.',
      suggestion: 'Add <meta name="twitter:card" content="summary_large_image">.',
    });
  }

  // 7. <h1> — exactly one is the SEO convention.
  if (s.h1Count === 0) {
    issues.push({
      id: 'h1-missing',
      severity: 'high',
      rule: 'Heading structure',
      description: 'The page has no <h1>.',
      suggestion: 'Add a single, descriptive <h1> that names the page topic.',
    });
  } else if (s.h1Count > 1) {
    issues.push({
      id: 'h1-multiple',
      severity: 'medium',
      rule: 'Heading structure',
      description: `The page has ${s.h1Count} <h1> elements.`,
      suggestion: 'Use one <h1> per page; use <h2>+ for subsequent sections.',
      detail: `${s.h1Count} h1s`,
    });
  }

  // 8. Structured data — encouraged when present, flagged when broken.
  if (s.structuredDataBlocks > 0 && !s.structuredDataValid) {
    issues.push({
      id: 'structured-data-invalid',
      severity: 'medium',
      rule: 'Structured data',
      description: 'Found <script type="application/ld+json"> but none parsed as valid JSON.',
      suggestion: 'Validate the JSON-LD with schema.org / Google\'s Rich Results test.',
    });
  }

  // 9. robots — flag noindex on a page the user is auditing (likely surprising).
  if (s.metaRobots && /noindex/i.test(s.metaRobots)) {
    issues.push({
      id: 'robots-noindex',
      severity: 'critical',
      rule: 'Robots directive',
      description: 'The page has <meta name="robots" content="…noindex…"> — search engines won\'t index it.',
      suggestion: 'Remove "noindex" if you DO want this page indexed. Otherwise this is intentional.',
      detail: s.metaRobots,
    });
  }

  // 10. images without alt — overlap with a11y but SEO-relevant.
  if (s.imgsMissingAlt > 0) {
    issues.push({
      id: 'img-alt-missing',
      severity: 'low',
      rule: 'Image alt text',
      description: `${s.imgsMissingAlt} image(s) have no \`alt\` attribute.`,
      suggestion: 'Add descriptive alt="…" so images contribute to indexability and accessibility.',
      detail: `${s.imgsMissingAlt} imgs`,
    });
  }

  // 11. <html lang> — minor SEO + a11y.
  if (!s.htmlLang) {
    issues.push({
      id: 'html-lang-missing',
      severity: 'low',
      rule: 'Document language',
      description: 'The <html> element has no `lang` attribute.',
      suggestion: 'Set lang on <html>, e.g. <html lang="en">.',
    });
  }

  const facts = {
    titleLength,
    descriptionLength: descLength,
    canonical: s.canonical,
    ogKeys,
    twitterKeys: Object.keys(s.twitterCard).length,
    structuredData: s.structuredDataBlocks,
  };

  return {
    score: scoreFor(issues),
    issues: issues.sort((a, b) => severityRank(a.severity) - severityRank(b.severity)),
    facts,
  };
}

function severityRank(s: SeoSeverity): number {
  return s === 'critical' ? 0 : s === 'high' ? 1 : s === 'medium' ? 2 : 3;
}

/** Score 0-100: start at 100, subtract severity weight per issue, floor at 0. */
export function scoreFor(issues: ReadonlyArray<SeoIssue>): number {
  let s = 100;
  for (const i of issues) s -= SEVERITY_WEIGHT[i.severity];
  return Math.max(0, s);
}
