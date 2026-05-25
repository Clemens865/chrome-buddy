// Framework-aware error pattern table. Ported faithfully from
// Console-Buddy upstream (src/components/debug/ErrorPatternRecognizer.tsx,
// 26+ patterns). Pure regex matching — no chrome, no I/O — so it unit-tests
// in isolation and can be called from either an agent tool or the UI.

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface ErrorPattern {
  pattern: RegExp;
  category: string;
  framework?: string;
  description: string;
  suggestion: string;
  severity: Severity;
  docUrl?: string;
}

export interface ErrorMatch {
  text: string;
  category: string;
  framework?: string;
  description: string;
  suggestion: string;
  severity: Severity;
  docUrl?: string;
  /** How many input entries shared this matched pattern. */
  count: number;
}

export const ERROR_PATTERNS: ErrorPattern[] = [
  // --- JavaScript ----------------------------------------------------------
  { pattern: /Cannot read propert(?:y|ies)(?:\s+\S+)?\s+of\s+(?:undefined|null)/i, category: 'Null Reference', framework: 'JavaScript',
    description: 'Attempting to access property on null/undefined',
    suggestion: 'Add null checks or use optional chaining (?.)', severity: 'high' },
  // --- React ---------------------------------------------------------------
  { pattern: /Maximum update depth exceeded/i, category: 'React', framework: 'React',
    description: 'Infinite loop in useEffect or setState',
    suggestion: 'Check useEffect dependencies and avoid setState in render', severity: 'critical',
    docUrl: 'https://reactjs.org/docs/hooks-faq.html#what-can-i-do-if-my-effect-dependencies-change-too-often' },
  { pattern: /Warning: Each child in a list should have a unique "key" prop/i, category: 'React', framework: 'React',
    description: 'Missing key prop in list rendering',
    suggestion: 'Add unique key prop to list items', severity: 'medium',
    docUrl: 'https://reactjs.org/docs/lists-and-keys.html' },
  { pattern: /Warning: Can't perform a React state update on an unmounted component/i, category: 'React', framework: 'React',
    description: 'Memory leak — updating unmounted component',
    suggestion: 'Clean up subscriptions/async operations in useEffect return', severity: 'high' },
  { pattern: /Invalid hook call/i, category: 'React', framework: 'React',
    description: 'Hooks called outside component or conditionally',
    suggestion: 'Only call hooks at the top level of function components', severity: 'critical',
    docUrl: 'https://reactjs.org/docs/hooks-rules.html' },
  { pattern: /Warning: Encountered two children with the same key/i, category: 'React', framework: 'React',
    description: 'Duplicate keys in list',
    suggestion: 'Ensure all keys are unique within the list', severity: 'medium' },
  { pattern: /Objects are not valid as a React child/i, category: 'React', framework: 'React',
    description: 'Trying to render an object directly',
    suggestion: 'Convert object to string or render its properties', severity: 'high' },
  // --- Vue -----------------------------------------------------------------
  { pattern: /\[Vue warn\]/i, category: 'Vue', framework: 'Vue',
    description: 'Vue runtime warning',
    suggestion: 'Check the warning message for specific issue', severity: 'medium' },
  { pattern: /Property or method .* is not defined on the instance/i, category: 'Vue', framework: 'Vue',
    description: 'Undefined property accessed in template',
    suggestion: 'Define the property in data() or computed', severity: 'high' },
  // --- Angular -------------------------------------------------------------
  { pattern: /NG0\d+/i, category: 'Angular', framework: 'Angular',
    description: 'Angular runtime error',
    suggestion: 'Check Angular docs for error code', severity: 'high',
    docUrl: 'https://angular.io/errors' },
  { pattern: /ExpressionChangedAfterItHasBeenCheckedError/i, category: 'Angular', framework: 'Angular',
    description: 'Value changed after change detection',
    suggestion: 'Use ChangeDetectorRef or setTimeout', severity: 'medium' },
  // --- Network -------------------------------------------------------------
  { pattern: /Failed to fetch/i, category: 'Network',
    description: 'Network request failed',
    suggestion: 'Check network connection, CORS settings, or server availability', severity: 'high' },
  { pattern: /NetworkError when attempting to fetch/i, category: 'Network',
    description: 'Network error during fetch',
    suggestion: 'Check if the server is reachable and CORS is configured', severity: 'high' },
  { pattern: /net::ERR_/i, category: 'Network',
    description: 'Chrome network error',
    suggestion: 'Check the specific error code for details', severity: 'medium' },
  { pattern: /CORS.*blocked/i, category: 'CORS',
    description: 'Cross-origin request blocked',
    suggestion: 'Configure CORS headers on the server or use a proxy', severity: 'high' },
  { pattern: /Access-Control-Allow-Origin/i, category: 'CORS',
    description: 'CORS header issue',
    suggestion: 'Server needs to send proper Access-Control-Allow-Origin header', severity: 'high' },
  // --- Security ------------------------------------------------------------
  { pattern: /Content Security Policy/i, category: 'Security',
    description: 'CSP violation',
    suggestion: 'Adjust CSP headers or modify code to comply', severity: 'high' },
  { pattern: /blocked by CORS policy/i, category: 'Security',
    description: 'CORS policy blocked request',
    suggestion: 'Configure CORS on server or use same-origin requests', severity: 'medium' },
  { pattern: /Mixed Content/i, category: 'Security',
    description: 'HTTP content on HTTPS page',
    suggestion: 'Use HTTPS for all resources', severity: 'high' },
  // --- Type / Syntax / Reference ------------------------------------------
  { pattern: /TypeError: .* is not a function/i, category: 'Type Error',
    description: 'Called non-function as function',
    suggestion: 'Check that the variable is actually a function', severity: 'high' },
  { pattern: /TypeError: .* is not an object/i, category: 'Type Error',
    description: 'Expected object, got primitive',
    suggestion: 'Verify the value is an object before accessing properties', severity: 'high' },
  { pattern: /SyntaxError/i, category: 'Syntax',
    description: 'JavaScript syntax error',
    suggestion: 'Check for typos, missing brackets, or invalid syntax', severity: 'critical' },
  { pattern: /Unexpected token/i, category: 'Syntax',
    description: 'Unexpected character in code',
    suggestion: 'Check for syntax errors near the reported location', severity: 'critical' },
  { pattern: /ReferenceError: .* is not defined/i, category: 'Reference',
    description: 'Variable not defined',
    suggestion: 'Declare the variable or check spelling', severity: 'high' },
  // --- Deprecation / Performance ------------------------------------------
  { pattern: /deprecated/i, category: 'Deprecation',
    description: 'Using deprecated API',
    suggestion: 'Update to use the recommended alternative', severity: 'low' },
  { pattern: /Violation.*took \d+ms/i, category: 'Performance',
    description: 'Long-running operation detected',
    suggestion: 'Optimize the operation or move to Web Worker', severity: 'medium' },
  { pattern: /\[Intervention\]/i, category: 'Performance',
    description: 'Browser intervention for performance',
    suggestion: 'Follow the suggested changes in the message', severity: 'medium' },
];

/**
 * Match a list of error/log message texts against the pattern table. Groups
 * identical matches (same pattern hit multiple times) into one entry with a
 * count. Pure; safe to unit-test in any environment.
 */
export function matchErrors(texts: readonly string[]): ErrorMatch[] {
  const byCategory = new Map<string, ErrorMatch>();
  for (const raw of texts) {
    const text = (raw ?? '').toString();
    if (!text) continue;
    let hit: ErrorPattern | undefined;
    for (const p of ERROR_PATTERNS) {
      if (p.pattern.test(text)) {
        hit = p;
        break;
      }
    }
    if (!hit) continue;
    const key = `${hit.category}|${hit.description}`;
    const existing = byCategory.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      byCategory.set(key, {
        text,
        category: hit.category,
        framework: hit.framework,
        description: hit.description,
        suggestion: hit.suggestion,
        severity: hit.severity,
        docUrl: hit.docUrl,
        count: 1,
      });
    }
  }
  return Array.from(byCategory.values()).sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

function severityRank(s: Severity): number {
  return s === 'critical' ? 0 : s === 'high' ? 1 : s === 'medium' ? 2 : 3;
}
