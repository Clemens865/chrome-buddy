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
