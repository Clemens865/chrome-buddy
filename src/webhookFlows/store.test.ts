// Tests for the pure helper(s) on the flow store. CRUD is exercised end-to-end
// in the e2e tests against fake-indexeddb-backed integration is not added here
// because the IDB layer is shared infra already covered elsewhere.
import { describe, it, expect } from 'vitest';
import { groupByCategory, type WebhookFlow } from './store';

function makeFlow(name: string, categoryName: string, ts = 0): WebhookFlow {
  return {
    id: `flw_${name}`,
    name,
    categoryName,
    webhookName: 'wh',
    snapshotMode: 'text',
    includeSelection: true,
    includeProfile: true,
    trustNoConfirm: false,
    createdAt: ts,
    updatedAt: ts,
  };
}

describe('groupByCategory', () => {
  it('groups flows by their categoryName field', () => {
    const flows = [
      makeFlow('a', 'Research'),
      makeFlow('b', 'Research'),
      makeFlow('c', 'Personal'),
    ];
    const groups = groupByCategory(flows);
    expect(groups).toEqual([
      { category: 'Personal', flows: [flows[2]] },
      { category: 'Research', flows: [flows[0], flows[1]] },
    ]);
  });

  it('puts empty/missing categoryName into Uncategorized and sinks it to the end', () => {
    const flows = [
      makeFlow('a', ''),
      makeFlow('b', 'Work'),
      makeFlow('c', '   '), // whitespace counts as empty
    ];
    const groups = groupByCategory(flows);
    expect(groups.map((g) => g.category)).toEqual(['Work', 'Uncategorized']);
    expect(groups.find((g) => g.category === 'Uncategorized')?.flows).toHaveLength(2);
  });

  it('preserves input order within each group', () => {
    const flows = [
      makeFlow('alpha', 'Research', 2),
      makeFlow('beta', 'Research', 1),
      makeFlow('gamma', 'Research', 3),
    ];
    const groups = groupByCategory(flows);
    expect(groups[0].flows.map((f) => f.name)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('returns an empty array for empty input', () => {
    expect(groupByCategory([])).toEqual([]);
  });
});
