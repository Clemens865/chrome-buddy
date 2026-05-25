// Frontend tech-stack fingerprint. Wappalyzer-style rules — given a structural
// probe collected on the page (window globals, script src list, meta generator,
// link href list, cookie names), score which frameworks / libraries / hosts /
// analytics are in use. Pure scoring — no chrome, no I/O.

export type TechCategory =
  | 'JavaScript Framework'
  | 'UI Library'
  | 'CSS Framework'
  | 'State Management'
  | 'Bundler / Build'
  | 'Analytics'
  | 'CMS'
  | 'CDN / Host'
  | 'CMS Plugin'
  | 'Tag Manager'
  | 'Other';

export interface TechProbe {
  /** window-side global names that are present. */
  globals: readonly string[];
  /** Resolved src attributes of `<script>` elements (absolute URLs). */
  scripts: readonly string[];
  /** Resolved href attributes of `<link>` elements (stylesheets, icons, etc.). */
  links: readonly string[];
  /** Value of `<meta name="generator" content="…">` if any. */
  metaGenerator?: string;
  /** Names of cookies on document.cookie. */
  cookies: readonly string[];
}

export interface TechRule {
  name: string;
  category: TechCategory;
  /** All conditions must hold for the rule to match (AND). */
  conditions: ReadonlyArray<TechCondition>;
}

export type TechCondition =
  | { kind: 'global'; name: string }
  | { kind: 'script'; pattern: RegExp }
  | { kind: 'link'; pattern: RegExp }
  | { kind: 'meta'; pattern: RegExp }
  | { kind: 'cookie'; name: string };

export interface TechMatch {
  name: string;
  category: TechCategory;
  /** Which signals contributed — useful for UI evidence tooltips. */
  evidence: string[];
}

export const TECH_RULES: TechRule[] = [
  // --- JS Frameworks -------------------------------------------------------
  { name: 'React', category: 'JavaScript Framework',
    conditions: [{ kind: 'global', name: 'React' }] },
  { name: 'React', category: 'JavaScript Framework',
    conditions: [{ kind: 'script', pattern: /react(?:-dom)?(?:\.production|\.development)?(?:\.min)?\.js/i }] },
  { name: 'Next.js', category: 'JavaScript Framework',
    conditions: [{ kind: 'global', name: '__NEXT_DATA__' }] },
  { name: 'Next.js', category: 'JavaScript Framework',
    conditions: [{ kind: 'script', pattern: /\/_next\/static\//i }] },
  { name: 'Vue.js', category: 'JavaScript Framework',
    conditions: [{ kind: 'global', name: 'Vue' }] },
  { name: 'Vue.js', category: 'JavaScript Framework',
    conditions: [{ kind: 'script', pattern: /vue(?:\.runtime)?(?:\.min)?\.js/i }] },
  { name: 'Nuxt', category: 'JavaScript Framework',
    conditions: [{ kind: 'global', name: '__NUXT__' }] },
  { name: 'Angular', category: 'JavaScript Framework',
    conditions: [{ kind: 'global', name: 'ng' }] },
  { name: 'Angular', category: 'JavaScript Framework',
    conditions: [{ kind: 'script', pattern: /angular(?:\.min)?\.js/i }] },
  { name: 'Svelte', category: 'JavaScript Framework',
    conditions: [{ kind: 'script', pattern: /svelte/i }] },
  { name: 'Ember.js', category: 'JavaScript Framework',
    conditions: [{ kind: 'global', name: 'Ember' }] },
  { name: 'jQuery', category: 'UI Library',
    conditions: [{ kind: 'global', name: 'jQuery' }] },
  // --- State Management ----------------------------------------------------
  { name: 'Redux', category: 'State Management',
    conditions: [{ kind: 'global', name: '__REDUX_DEVTOOLS_EXTENSION__' }] },
  // --- CSS Frameworks ------------------------------------------------------
  { name: 'Tailwind CSS', category: 'CSS Framework',
    conditions: [{ kind: 'link', pattern: /tailwind/i }] },
  { name: 'Bootstrap', category: 'CSS Framework',
    conditions: [{ kind: 'link', pattern: /bootstrap(?:\.min)?\.css/i }] },
  { name: 'Bootstrap', category: 'CSS Framework',
    conditions: [{ kind: 'script', pattern: /bootstrap(?:\.bundle)?(?:\.min)?\.js/i }] },
  // --- CMS / generator -----------------------------------------------------
  { name: 'WordPress', category: 'CMS',
    conditions: [{ kind: 'meta', pattern: /wordpress/i }] },
  { name: 'WordPress', category: 'CMS',
    conditions: [{ kind: 'script', pattern: /wp-content|wp-includes/i }] },
  { name: 'Shopify', category: 'CMS',
    conditions: [{ kind: 'global', name: 'Shopify' }] },
  { name: 'Wix', category: 'CMS',
    conditions: [{ kind: 'meta', pattern: /wix\.com/i }] },
  // --- Analytics + Tag Managers --------------------------------------------
  { name: 'Google Analytics', category: 'Analytics',
    conditions: [{ kind: 'global', name: 'gtag' }] },
  { name: 'Google Tag Manager', category: 'Tag Manager',
    conditions: [{ kind: 'script', pattern: /googletagmanager\.com\/gtm/i }] },
  { name: 'Segment', category: 'Analytics',
    conditions: [{ kind: 'global', name: 'analytics' }] },
  { name: 'Mixpanel', category: 'Analytics',
    conditions: [{ kind: 'global', name: 'mixpanel' }] },
  { name: 'Hotjar', category: 'Analytics',
    conditions: [{ kind: 'global', name: 'hj' }] },
  // --- CDN / Hosts ---------------------------------------------------------
  { name: 'Cloudflare', category: 'CDN / Host',
    conditions: [{ kind: 'cookie', name: '__cfduid' }] },
  { name: 'Vercel', category: 'CDN / Host',
    conditions: [{ kind: 'script', pattern: /vercel\.app|_vercel/i }] },
];

/**
 * Apply each rule against the probe; an `OR` group is achieved by listing
 * multiple rules with the same `name + category`. Deduplicate matches with
 * merged evidence trails.
 */
export function detectTech(probe: TechProbe): TechMatch[] {
  const byKey = new Map<string, TechMatch>();
  for (const rule of TECH_RULES) {
    const evidence = evaluateConditions(rule.conditions, probe);
    if (!evidence) continue;
    const key = `${rule.category}|${rule.name}`;
    const existing = byKey.get(key);
    if (existing) {
      // Deduplicate evidence (a rule + an alt rule might both match the same probe).
      for (const e of evidence) if (!existing.evidence.includes(e)) existing.evidence.push(e);
    } else {
      byKey.set(key, { name: rule.name, category: rule.category, evidence: [...evidence] });
    }
  }
  return Array.from(byKey.values()).sort((a, b) =>
    a.category === b.category ? a.name.localeCompare(b.name) : categoryRank(a.category) - categoryRank(b.category),
  );
}

function evaluateConditions(
  conditions: ReadonlyArray<TechCondition>,
  probe: TechProbe,
): string[] | null {
  const evidence: string[] = [];
  for (const cond of conditions) {
    const ev = evaluate(cond, probe);
    if (!ev) return null;
    evidence.push(ev);
  }
  return evidence;
}

function evaluate(cond: TechCondition, probe: TechProbe): string | null {
  switch (cond.kind) {
    case 'global':
      return probe.globals.includes(cond.name) ? `window.${cond.name}` : null;
    case 'script': {
      const hit = probe.scripts.find((s) => cond.pattern.test(s));
      return hit ? `script: ${hit}` : null;
    }
    case 'link': {
      const hit = probe.links.find((s) => cond.pattern.test(s));
      return hit ? `link: ${hit}` : null;
    }
    case 'meta': {
      const g = probe.metaGenerator ?? '';
      return cond.pattern.test(g) ? `meta generator: ${g}` : null;
    }
    case 'cookie':
      return probe.cookies.includes(cond.name) ? `cookie: ${cond.name}` : null;
  }
}

function categoryRank(c: TechCategory): number {
  const order: TechCategory[] = [
    'JavaScript Framework',
    'UI Library',
    'State Management',
    'CSS Framework',
    'Bundler / Build',
    'CMS',
    'Analytics',
    'Tag Manager',
    'CDN / Host',
    'CMS Plugin',
    'Other',
  ];
  const i = order.indexOf(c);
  return i === -1 ? order.length : i;
}
