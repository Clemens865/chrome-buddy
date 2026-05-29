// Export/import for apps (P4). A bundle is portable JSON; importing RE-VALIDATES
// every app through the same per-tier parsers used at generation time (so a
// tampered/garbage entry is dropped, ids are reassigned, capabilities are
// allowlisted, and reviewed is forced false → the first-run review gate runs
// before any imported app executes). Mirrors the workflow/skill bundle pattern.
import { type AppConfig, APP_SCHEMA_VERSION } from './types';
import { parseAppConfig, parseCodeApp } from './build';
import { parseUiApp, toAppConfig } from './uiBuild';

export interface AppBundle {
  schemaVersion: number;
  apps: AppConfig[];
}

export interface AppImportReview {
  /** Apps that re-validated and will be imported (reviewed:false, fresh ids). */
  apps: AppConfig[];
  /** True when the bundle was made with a newer app schema than we understand. */
  fromNewerVersion: boolean;
  /** Count of entries that failed re-validation and were dropped. */
  dropped: number;
}

/** Export apps as a portable, re-validatable bundle. */
export function toAppBundle(apps: AppConfig[]): AppBundle {
  return { schemaVersion: APP_SCHEMA_VERSION, apps };
}

/** Re-validate one raw app entry by routing it through the tier's parser. The
 *  parsers reassign ids, allowlist capabilities, and (Tier-2/3) set reviewed:false. */
function revalidate(raw: unknown): AppConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const tier = (raw as { tier?: unknown }).tier;
  const json = JSON.stringify(raw);
  if (tier === 3) {
    const parsed = parseUiApp(json);
    return parsed ? toAppConfig(parsed) : null;
  }
  if (tier === 2) return parseCodeApp(json);
  return parseAppConfig(json);
}

/** Parse + re-validate an imported app bundle. Drops bad entries; never throws. */
export function parseAppBundle(json: string): AppImportReview {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { apps: [], fromNewerVersion: false, dropped: 0 };
  }
  const obj = (data ?? {}) as { schemaVersion?: unknown; apps?: unknown };
  const rawApps = Array.isArray(obj.apps) ? obj.apps : [];
  const apps: AppConfig[] = [];
  let dropped = 0;
  for (const raw of rawApps) {
    const app = revalidate(raw);
    if (app) apps.push(app);
    else dropped += 1;
  }
  const ver = typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 0;
  return { apps, fromNewerVersion: ver > APP_SCHEMA_VERSION, dropped };
}
