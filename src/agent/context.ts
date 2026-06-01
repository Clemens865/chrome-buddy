// Pure helpers for assembling the optional context block attached to a chat
// message: the current page's content and/or the user's profile. Keeping this
// pure makes it unit-testable without chrome/network.

export interface UserProfile {
  name?: string;
  role?: string;
  about?: string;
}

/** The user keeps two switchable profiles (cf. MicroLabs personal/professional). */
export type ProfileKind = 'professional' | 'personal';

export interface Profiles {
  professional: UserProfile;
  personal: UserProfile;
}

export const EMPTY_PROFILES: Profiles = {
  professional: {},
  personal: {},
};

export interface PageSummaryLite {
  url: string;
  title: string;
  text: string;
}

/** Build a single context string (empty when nothing to attach). */
export function buildContextBlock(
  page: PageSummaryLite | null,
  profile: UserProfile | null,
  profileLabel?: string,
): string {
  const parts: string[] = [];

  if (page && (page.text.trim() || page.title.trim())) {
    parts.push(`# Current page\nURL: ${page.url}\nTitle: ${page.title}\n\n${page.text}`.trim());
  }

  if (profile) {
    const lines = [
      profile.name?.trim() && `Name: ${profile.name.trim()}`,
      profile.role?.trim() && `Role: ${profile.role.trim()}`,
      profile.about?.trim(),
    ].filter(Boolean);
    if (lines.length) {
      const heading = profileLabel ? `# About the user (${profileLabel})` : '# About the user';
      parts.push(`${heading}\n${lines.join('\n')}`);
    }
  }

  return parts.join('\n\n---\n\n');
}

/** True when the profile has any content worth attaching. */
export function hasProfile(profile: UserProfile | null | undefined): boolean {
  return !!profile && !!(profile.name?.trim() || profile.role?.trim() || profile.about?.trim());
}

export interface CollectionSummary {
  id: string;
  name: string;
  description: string;
  autoContext: 'always' | 'active' | 'manual';
}

/**
 * Build the "Knowledge collections" block that tells the model which library
 * collections exist + their ids, so it knows to call
 * `search_library(query, collection)` against the right one. Always-on
 * collections are flagged so the model doesn't redundantly search what's
 * already injected. Pure; '' when there's nothing worth listing.
 */
export function buildCollectionsBlock(collections: readonly CollectionSummary[]): string {
  const usable = collections.filter((c) => c?.id && c?.name);
  if (usable.length === 0) return '';
  const lines = usable.map((c) => {
    const desc = c.description?.trim() ? ` — ${c.description.trim()}` : '';
    const flag = c.autoContext === 'always' ? ' (already in context)' : '';
    return `- \`${c.id}\`: ${c.name}${desc}${flag}`;
  });
  return [
    '# Knowledge collections',
    "The user's private library is organized into these collections. When a question " +
      'relates to one, call `search_library(query, collection)` with the matching id:',
    ...lines,
  ].join('\n');
}

/**
 * The collection ids that should be auto-retrieved for a chat message: every
 * 'always' collection, plus the 'active' collections the user has toggled on
 * for this session. Pure. Returns [] when nothing is auto-on.
 */
export function autoContextCollectionIds(
  collections: readonly CollectionSummary[],
  activeOn: ReadonlySet<string>,
): string[] {
  return collections
    .filter((c) => c?.id && (c.autoContext === 'always' || (c.autoContext === 'active' && activeOn.has(c.id))))
    .map((c) => c.id);
}

/**
 * Build a context block from several explicitly-picked tabs (multi-tab chat).
 * Each tab is fenced under its own heading so the model can attribute facts to
 * the right source. Tabs with no usable content are skipped; '' when none.
 */
export function buildMultiPageContextBlock(pages: PageSummaryLite[]): string {
  const blocks = pages
    .filter((p) => p && (p.text.trim() || p.title.trim()))
    .map((p) => `## ${p.title || p.url}\nURL: ${p.url}\n\n${p.text}`.trim());
  if (!blocks.length) return '';
  return `# Selected tabs (${blocks.length})\n\n${blocks.join('\n\n---\n\n')}`;
}
