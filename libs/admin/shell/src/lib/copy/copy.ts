/**
 * Plain-language copy for the screens everyone uses (package 11). Client roles never see the developer's words
 * for things: a client edits a "page", not an "entry"; there is one site, not "environments"; and a page has a
 * "type", not a "content type". Screens shared by both modes take their wording from here, so it stays the same
 * everywhere; agency-only screens (Schema, API tokens) may use the technical terms.
 */
export const copy = {
  dashboard: 'Dashboard',
  page: 'page',
  pages: 'Pages',
  newPage: 'New page',
  pageType: 'Type',
  saveDraft: 'Save draft',
  publish: 'Publish',
  publishChanges: 'Publish changes',
  unpublish: 'Unpublish',
  versionHistory: 'Version history',
  restoreVersion: 'Restore this version',
  media: 'Media',
  forms: 'Forms',
  settings: 'Settings',
  siteSettings: 'Site settings',
  team: 'Team',
  draft: 'Draft',
  published: 'Published',
  unsavedChanges: 'Unsaved changes',
} as const;

export type CopyKey = keyof typeof copy;

/** Words that must never reach a client-mode screen. The e2e `@shell` journey scans for the same list. */
export const agencyOnlyWords: readonly string[] = ['entry', 'entries', 'environment', 'environments', 'content type', 'content types'];

/** Matches each of {@link agencyOnlyWords} as a whole word, ignoring case. */
export const agencyOnlyWordsPattern = new RegExp(`\\b(${agencyOnlyWords.map((word) => word.replace(' ', '\\s+')).join('|')})\\b`, 'i');
