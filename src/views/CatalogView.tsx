// Discover — the Buddy Marketplace gallery. Fetches the public catalog index
// (raw GitHub, no auth), renders installable cards, and installs an entry by
// fetching its data file and routing it through parseAppBundle (which
// re-validates: fresh ids, allow-listed caps, reviewed:false → review gate on
// first run). Install itself is handed up to AppsView (persist + refresh).
import { useEffect, useState } from 'react';
import { Ic } from '../ui/icons';
import { fetchCatalogIndex, fetchEntryData, type CatalogEntry } from '../catalog';
import { parseAppBundle } from '../apps/appBundle';
import type { AppConfig } from '../apps/types';

export function CatalogView({
  onBack,
  onInstall,
  installedNames,
}: {
  onBack: () => void;
  onInstall: (apps: AppConfig[]) => Promise<void>;
  /** Names of already-installed apps (install re-validation reassigns ids, so
   *  we match by name for the MVP; version-aware updates come later). */
  installedNames: Set<string>;
}) {
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchCatalogIndex()
      .then((idx) => setEntries(idx.entries))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const install = async (entry: CatalogEntry) => {
    setBusyId(entry.id);
    setError(null);
    try {
      const review = parseAppBundle(await fetchEntryData(entry));
      if (review.apps.length === 0) {
        setError(`"${entry.name}" could not be validated and was not installed.`);
        return;
      }
      await onInstall(review.apps);
      setDone((prev) => new Set(prev).add(entry.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const isInstalled = (e: CatalogEntry): boolean => installedNames.has(e.name) || done.has(e.id);

  return (
    <div className="micro" data-testid="catalog-view">
      <div className="app-hd">
        <button type="button" className="app-hd-back" onClick={onBack} aria-label="Back to apps"><span className="ic">{Ic.collapse}</span></button>
        <div className="app-hd-name">Discover</div>
      </div>
      <div className="micro-body">
        <div className="catalog-intro">Install community + first-party apps. Each runs sandboxed and asks before any consequential action.</div>
        {error && <div className="empty-state-desc" style={{ color: '#B91C1C' }}>{error}</div>}
        {entries === null && !error && <div className="empty-state-desc">Loading catalog…</div>}
        {entries !== null && entries.length === 0 && <div className="empty-state-desc">No entries in the catalog yet.</div>}
        {entries?.filter((e) => e.kind === 'app').map((e) => {
          const installedNow = isInstalled(e);
          return (
            <div key={e.id} className="catalog-card" data-testid={`catalog-card-${e.id}`}>
              <div className="catalog-card-body">
                <div className="catalog-card-name">{e.name} <span className="catalog-tier">Tier {e.tier ?? 1}</span></div>
                <div className="catalog-card-desc">{e.description}</div>
                {!!e.permissions?.length && (
                  <div className="catalog-perms">needs: {e.permissions.join(' · ')}</div>
                )}
              </div>
              <button
                type="button"
                className={'btn btn-sm ' + (installedNow ? 'btn-ghost' : 'btn-primary')}
                disabled={busyId === e.id || installedNow}
                onClick={() => void install(e)}
                data-testid={`catalog-install-${e.id}`}
              >
                {busyId === e.id ? 'Installing…' : installedNow ? 'Installed' : 'Install'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
