// search_catalog SW handler. Fetches the PUBLIC catalog index (raw GitHub, no
// auth) and keyword-filters it — so the agent can surface installable apps in
// chat. Read-only, non-consequential; the actual install happens panel-side
// (fetch the entry → re-validate via parseAppBundle → persist), so the model
// never writes to the app store directly.
import { ok, err, type ToolResult } from '../types';
import { fetchCatalogIndex, filterCatalog } from '../catalog';

export async function executeSearchCatalog(args: Record<string, unknown>): Promise<ToolResult> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  try {
    const idx = await fetchCatalogIndex();
    const matches = filterCatalog(idx.entries, query).slice(0, 8);
    return ok({
      query,
      count: matches.length,
      entries: matches.map((e) => ({
        id: e.id,
        name: e.name,
        description: e.description,
        kind: e.kind,
        tier: e.tier,
        version: e.version,
        permissions: e.permissions,
        dataPath: e.dataPath,
      })),
    });
  } catch (e) {
    return err('runtime-error', e instanceof Error ? e.message : String(e));
  }
}
