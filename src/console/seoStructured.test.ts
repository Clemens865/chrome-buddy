import { describe, it, expect } from 'vitest';
import { validateStructuredData, detectedTypes, recognizedType, type JsonLdBlock } from './seoStructured';

describe('recognizedType', () => {
  it('matches known types case-insensitively, incl. array types', () => {
    expect(recognizedType('Article')).toBe('article');
    expect(recognizedType('WebPage,Product')).toBe('product');
    expect(recognizedType('SomethingWeird')).toBeUndefined();
  });
});

describe('validateStructuredData', () => {
  it('flags a recognized type missing recommended fields', () => {
    const blocks: JsonLdBlock[] = [{ type: 'Article', keys: ['headline', 'image'] }];
    const f = validateStructuredData(blocks);
    expect(f).toHaveLength(1);
    expect(f[0].type).toBe('Article');
    expect(f[0].missing).toEqual(['author', 'datePublished']);
  });

  it('produces nothing for a complete block', () => {
    const blocks: JsonLdBlock[] = [{ type: 'Product', keys: ['name', 'image', 'offers', 'sku'] }];
    expect(validateStructuredData(blocks)).toEqual([]);
  });

  it('ignores unknown types', () => {
    expect(validateStructuredData([{ type: 'CustomThing', keys: [] }])).toEqual([]);
  });

  it('is case-insensitive on field presence', () => {
    expect(validateStructuredData([{ type: 'website', keys: ['Name', 'URL'] }])).toEqual([]);
  });
});

describe('detectedTypes', () => {
  it('returns distinct type labels across blocks', () => {
    expect(detectedTypes([{ type: 'Article', keys: [] }, { type: 'Organization,WebSite', keys: [] }, { type: 'Article', keys: [] }]).sort())
      .toEqual(['Article', 'Organization', 'WebSite']);
  });
});
