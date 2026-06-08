// Structured-data (JSON-LD) validation for the SEO panel. Search engines turn
// schema.org markup into rich results — but only if the recommended fields are
// present. Given the @type + top-level keys of each JSON-LD block, flag the
// missing recommended fields per recognized type.
//
// Pure — no chrome, no I/O — fully unit-testable.

export interface JsonLdBlock {
  /** The block's @type (comma-joined if it was an array; '' when absent). */
  type: string;
  /** Top-level property names present on the object. */
  keys: string[];
}

export interface StructuredFinding {
  type: string;
  missing: string[];
}

/** Recommended fields per recognized schema.org type (lowercased keys). */
const RECOMMENDED: Record<string, string[]> = {
  article: ['headline', 'image', 'author', 'datePublished'],
  newsarticle: ['headline', 'image', 'author', 'datePublished'],
  blogposting: ['headline', 'image', 'author', 'datePublished'],
  product: ['name', 'image', 'offers'],
  faqpage: ['mainEntity'],
  qapage: ['mainEntity'],
  howto: ['name', 'step'],
  recipe: ['name', 'image', 'recipeIngredient'],
  organization: ['name', 'logo', 'url'],
  website: ['name', 'url'],
  breadcrumblist: ['itemListElement'],
  event: ['name', 'startDate', 'location'],
  videoobject: ['name', 'thumbnailUrl', 'uploadDate'],
};

/** Known types are matched case-insensitively for clarity in the UI. */
export function recognizedType(type: string): string | undefined {
  for (const t of type.split(',')) {
    const k = t.trim().toLowerCase();
    if (RECOMMENDED[k]) return k;
  }
  return undefined;
}

/**
 * Validate parsed JSON-LD blocks. Returns one finding per block whose recognized
 * type is missing recommended fields. Blocks with unknown types are ignored
 * (we don't claim to know every schema), and complete blocks produce nothing.
 */
export function validateStructuredData(blocks: ReadonlyArray<JsonLdBlock>): StructuredFinding[] {
  const out: StructuredFinding[] = [];
  for (const b of blocks) {
    const k = recognizedType(b.type);
    if (!k) continue;
    const have = new Set(b.keys.map((x) => x.toLowerCase()));
    const missing = RECOMMENDED[k].filter((f) => !have.has(f.toLowerCase()));
    if (missing.length) out.push({ type: b.type || k, missing });
  }
  return out;
}

/** Distinct recognized type labels across the blocks (for the facts/summary). */
export function detectedTypes(blocks: ReadonlyArray<JsonLdBlock>): string[] {
  const seen = new Set<string>();
  for (const b of blocks) {
    for (const t of b.type.split(',')) {
      const tt = t.trim();
      if (tt) seen.add(tt);
    }
  }
  return [...seen];
}
