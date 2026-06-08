// AEO — Answer Engine Optimization audit. Where SEO asks "will Google rank this
// page?", AEO asks "can an AI answer engine (ChatGPT, Claude, Perplexity, Google
// AI Overviews) READ, EXTRACT, and CITE this page?". The signals differ: machine-
// readable structured data, extractable Q&A, chunkable content, attributable
// facts (author/date), an llms.txt manifest, and whether AI crawlers are allowed.
//
// Pure module — no chrome, no I/O — fully unit-testable. The page probe + the
// robots.txt/llms.txt fetch happen in background/inspector.ts and are fed in.

export type AeoSeverity = 'critical' | 'high' | 'medium' | 'low';

/** Recognized AI crawler user-agents we look for in robots.txt. */
export const AI_CRAWLERS = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'CCBot'] as const;

export interface AeoSignal {
  url: string;
  title?: string;
  metaDescription?: string;
  htmlLang?: string;
  /** Number of <h1> elements. */
  h1Count: number;
  /** Total heading count (h1–h6) — a proxy for content structure/outline. */
  headingCount: number;
  /** Heading texts that read as questions (end with "?") — citable Q&A. */
  questionHeadings: number;
  /** Visible word count of the main text. */
  wordCount: number;
  /** Number of <p> blocks (chunkability). */
  paragraphCount: number;
  /** Average paragraph length in characters (0 when none). */
  avgParagraphChars: number;
  /** Count of <ul>/<ol>/<table> — scannable, extractable structures. */
  listOrTableCount: number;
  /** @type values found across all valid JSON-LD blocks (lowercased). */
  schemaTypes: string[];
  /** Number of <script type="application/ld+json"> blocks. */
  structuredDataBlocks: number;
  /** Whether every JSON-LD block parsed as valid JSON. */
  structuredDataValid: boolean;
  /** Any author signal (meta author, article:author, schema author). */
  hasAuthor: boolean;
  /** Any date signal (article:published_time, schema datePublished, <time>). */
  hasDate: boolean;
  /** /llms.txt exists (HTTP 200). undefined when the fetch could not run. */
  hasLlmsTxt?: boolean;
  /** AI crawlers explicitly Disallow:'d in robots.txt. undefined when unknown. */
  blockedAiCrawlers?: string[];
}

export interface AeoIssue {
  id: string;
  severity: AeoSeverity;
  rule: string;
  description: string;
  suggestion: string;
  detail?: string;
}

export interface AeoReport {
  /** 0–100 score from severity-weighted issues. */
  score: number;
  issues: AeoIssue[];
  facts: {
    schemaTypes: string[];
    wordCount: number;
    questionHeadings: number;
    hasFaq: boolean;
    hasLlmsTxt: boolean;
    aiCrawlersBlocked: number;
    attributable: boolean;
  };
}

const SEVERITY_WEIGHT: Record<AeoSeverity, number> = { critical: 25, high: 15, medium: 8, low: 3 };

const CITABLE_TYPES = ['article', 'newsarticle', 'blogposting', 'faqpage', 'howto', 'qapage', 'product', 'recipe'];

/** Run the AEO ruleset against a probe signal. Pure. */
export function analyzeAeo(s: AeoSignal): AeoReport {
  const issues: AeoIssue[] = [];
  const types = s.schemaTypes.map((t) => t.toLowerCase());
  const hasFaq = types.includes('faqpage') || types.includes('qapage') || s.questionHeadings >= 2;

  // 1. Structured data — the #1 way AI engines extract entities + answers.
  if (s.structuredDataBlocks === 0) {
    issues.push({
      id: 'schema-missing',
      severity: 'high',
      rule: 'Structured data',
      description: 'No schema.org JSON-LD found. AI answer engines rely on it to extract entities, facts, and relationships.',
      suggestion: 'Add a JSON-LD <script type="application/ld+json"> describing the page (Article, Product, FAQPage, Organization…).',
    });
  } else if (!s.structuredDataValid) {
    issues.push({
      id: 'schema-invalid',
      severity: 'medium',
      rule: 'Structured data',
      description: 'JSON-LD is present but at least one block is invalid JSON, so engines will skip it.',
      suggestion: "Validate every JSON-LD block with Google's Rich Results test / schema.org validator.",
    });
  } else if (!types.some((t) => CITABLE_TYPES.includes(t))) {
    issues.push({
      id: 'schema-weak-type',
      severity: 'medium',
      rule: 'Structured data',
      description: `JSON-LD exists but uses no citable content type (found: ${types.join(', ') || 'none'}).`,
      suggestion: 'Add an Article / FAQPage / HowTo / Product type so engines recognize the content, not just the site.',
      detail: types.join(', ') || undefined,
    });
  }

  // 2. FAQ / Q&A — the most directly citable structure for answer engines.
  if (!hasFaq) {
    issues.push({
      id: 'no-qa',
      severity: 'low',
      rule: 'Q&A structure',
      description: 'No FAQ/Q&A structure detected. Question-and-answer blocks are the format AI engines cite most directly.',
      suggestion: 'Add a FAQ section with question-style headings (and ideally FAQPage schema) covering what users actually ask.',
    });
  }

  // 3. Extractability — thin content can't be confidently cited.
  if (s.wordCount > 0 && s.wordCount < 300) {
    issues.push({
      id: 'thin-content',
      severity: 'medium',
      rule: 'Content depth',
      description: `Only ~${s.wordCount} words of body text. Engines prefer substantial, self-contained content they can quote.`,
      suggestion: 'Expand the main content so each key claim is stated explicitly in prose an engine can extract.',
      detail: `${s.wordCount} words`,
    });
  }

  // 4. Chunkability — wall-of-text pages are hard to segment + cite.
  if (s.wordCount >= 300 && s.listOrTableCount === 0 && s.avgParagraphChars > 600) {
    issues.push({
      id: 'poor-chunking',
      severity: 'low',
      rule: 'Chunkability',
      description: 'Long content with no lists/tables and very long paragraphs is hard for engines to segment into citable passages.',
      suggestion: 'Break content into shorter paragraphs and add bulleted lists / tables for key facts.',
      detail: `~${s.avgParagraphChars} chars/paragraph`,
    });
  }

  // 5. Topic clarity — a single clear H1 anchors the page topic.
  if (s.h1Count === 0) {
    issues.push({
      id: 'h1-missing',
      severity: 'medium',
      rule: 'Topic clarity',
      description: 'No <h1>. Engines use the primary heading to understand what the page is about.',
      suggestion: 'Add one clear, specific <h1> naming the page topic.',
    });
  } else if (s.h1Count > 1) {
    issues.push({
      id: 'h1-multiple',
      severity: 'low',
      rule: 'Topic clarity',
      description: `${s.h1Count} <h1> elements dilute the page's primary topic signal.`,
      suggestion: 'Use exactly one <h1>; demote the rest to <h2>.',
      detail: `${s.h1Count} h1s`,
    });
  }

  // 6. Attributability — engines favor content with an author + date.
  if (!s.hasAuthor || !s.hasDate) {
    const missing = [!s.hasAuthor ? 'author' : '', !s.hasDate ? 'date' : ''].filter(Boolean).join(' + ');
    issues.push({
      id: 'no-attribution',
      severity: 'low',
      rule: 'Attribution / E-E-A-T',
      description: `No ${missing} signal. AI engines weight attributable, dated, trustworthy sources higher when choosing what to cite.`,
      suggestion: 'Add author + datePublished (via Article schema, <meta>, or a visible byline) to strengthen trust signals.',
      detail: missing,
    });
  }

  // 7. Description — the primary snippet engines lift verbatim.
  if (!s.metaDescription?.trim()) {
    issues.push({
      id: 'desc-missing',
      severity: 'medium',
      rule: 'Answer snippet',
      description: 'No meta description. Engines often quote it as the one-line answer about this page.',
      suggestion: 'Add a concise <meta name="description"> that directly states what the page answers.',
    });
  }

  // 8. AI-crawler access — if blocked, citations are impossible.
  if (s.blockedAiCrawlers && s.blockedAiCrawlers.length > 0) {
    issues.push({
      id: 'ai-crawlers-blocked',
      severity: 'high',
      rule: 'AI crawler access',
      description: `robots.txt blocks ${s.blockedAiCrawlers.join(', ')}. These agents cannot read the page, so it can never be cited.`,
      suggestion: 'If you WANT AI citations, allow these user-agents in robots.txt. If the block is intentional (opt-out), this is expected.',
      detail: s.blockedAiCrawlers.join(', '),
    });
  }

  // 9. llms.txt — emerging manifest that guides AI agents to your key content.
  if (s.hasLlmsTxt === false) {
    issues.push({
      id: 'no-llms-txt',
      severity: 'low',
      rule: 'llms.txt manifest',
      description: 'No /llms.txt found. This emerging standard tells AI agents which pages + facts matter most on your site.',
      suggestion: 'Add an /llms.txt at the site root. Use the "Download llms.txt" button below as a starting draft.',
    });
  }

  const facts = {
    schemaTypes: types,
    wordCount: s.wordCount,
    questionHeadings: s.questionHeadings,
    hasFaq,
    hasLlmsTxt: s.hasLlmsTxt === true,
    aiCrawlersBlocked: s.blockedAiCrawlers?.length ?? 0,
    attributable: s.hasAuthor && s.hasDate,
  };

  return {
    score: scoreFor(issues),
    issues: issues.sort((a, b) => severityRank(a.severity) - severityRank(b.severity)),
    facts,
  };
}

function severityRank(s: AeoSeverity): number {
  return s === 'critical' ? 0 : s === 'high' ? 1 : s === 'medium' ? 2 : 3;
}

/** Score 0-100: start at 100, subtract severity weight per issue, floor at 0. */
export function scoreFor(issues: ReadonlyArray<AeoIssue>): number {
  let s = 100;
  for (const i of issues) s -= SEVERITY_WEIGHT[i.severity];
  return Math.max(0, s);
}

/**
 * PURE: parse robots.txt and return the recognized AI crawlers (from
 * AI_CRAWLERS) that are blocked from the site root (`Disallow: /`). Handles
 * consecutive `User-agent:` lines sharing one rule block + inline comments.
 */
export function parseBlockedAiCrawlers(robots: string): string[] {
  const lines = robots.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
  const groups: { agents: string[]; disallows: string[] }[] = [];
  let cur: { agents: string[]; disallows: string[] } | null = null;
  let expectingAgents = false;
  for (const line of lines) {
    const m = /^(user-agent|disallow|allow)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const val = m[2].trim();
    if (field === 'user-agent') {
      if (!expectingAgents || !cur) {
        cur = { agents: [], disallows: [] };
        groups.push(cur);
        expectingAgents = true;
      }
      cur.agents.push(val);
    } else {
      expectingAgents = false;
      if (cur && field === 'disallow') cur.disallows.push(val);
    }
  }
  const blocked = new Set<string>();
  for (const g of groups) {
    if (!g.disallows.some((d) => d === '/')) continue;
    for (const a of g.agents) {
      const hit = AI_CRAWLERS.find((name) => name.toLowerCase() === a.toLowerCase());
      if (hit) blocked.add(hit);
    }
  }
  return [...blocked];
}

/**
 * PURE: generate a starter llms.txt from the page signal + an optional content
 * outline (heading texts). Follows the llms.txt convention: an H1 site/page
 * name, a one-line blockquote summary, then link sections. The user downloads
 * this, customizes it, and drops it at their site root.
 */
export function buildLlmsTxt(
  s: Pick<AeoSignal, 'url' | 'title' | 'metaDescription'>,
  headings: readonly string[] = [],
): string {
  let host = s.url;
  try {
    host = new URL(s.url).host;
  } catch {
    /* keep raw */
  }
  const name = s.title?.trim() || host;
  const summary = s.metaDescription?.trim() || `Key content from ${host}.`;
  const lines: string[] = [];
  lines.push(`# ${name}`);
  lines.push('');
  lines.push(`> ${summary}`);
  lines.push('');
  lines.push('## Key pages');
  lines.push(`- [${name}](${s.url})`);
  lines.push('');
  const outline = headings.map((h) => h.trim()).filter(Boolean).slice(0, 12);
  if (outline.length > 0) {
    lines.push('## On this page');
    for (const h of outline) lines.push(`- ${h}`);
    lines.push('');
  }
  lines.push('## Notes');
  lines.push('- This file was drafted by Chrome Buddy. Review every line, then place it at https://' + host + '/llms.txt');
  lines.push('- Add your most important pages, docs, and the facts you want AI assistants to cite.');
  lines.push('');
  return lines.join('\n');
}
