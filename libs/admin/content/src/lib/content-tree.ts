import type { EntrySummary, Folder } from '@novan/shared-schemas';

export interface StatusBadge {
  label: string;
  // Not `success` or `warning`: in design system 2.5 their white text fails WCAG AA contrast
  // (3.9:1 and 2.5:1), an upstream issue.
  variant: 'neutral' | 'secondary' | 'info';
}

/** Plain-language status of a page; never colour alone, the label says it. */
export function statusBadges(entry: Pick<EntrySummary, 'status' | 'hasUnpublishedChanges' | 'deletedAt'>): StatusBadge[] {
  if (entry.deletedAt) return [{ label: 'In the bin', variant: 'neutral' }];
  if (entry.status === 'archived') return [{ label: 'Archived', variant: 'neutral' }];
  if (entry.status === 'in_review') {
    // A live page waiting for review of its changes.
    return entry.hasUnpublishedChanges
      ? [
          { label: 'Published', variant: 'secondary' },
          { label: 'Waiting for review', variant: 'info' },
        ]
      : [{ label: 'Waiting for review', variant: 'info' }];
  }
  if (entry.status !== 'published') return [{ label: 'Draft', variant: 'neutral' }];
  return entry.hasUnpublishedChanges
    ? [
        { label: 'Published', variant: 'secondary' },
        { label: 'Changes not published', variant: 'info' },
      ]
    : [{ label: 'Published', variant: 'secondary' }];
}

export interface FolderNode {
  folder: Folder;
  folders: FolderNode[];
  entries: EntrySummary[];
}

export interface ContentTree {
  folders: FolderNode[];
  /** Entries at the top level. */
  entries: EntrySummary[];
}

/** Folders and entries as a tree: folders first, each level sorted by name, entries by title. */
export function buildTree(folders: readonly Folder[], entries: readonly EntrySummary[]): ContentTree {
  const byTitle = (a: EntrySummary, b: EntrySummary) => a.title.localeCompare(b.title);
  const entriesIn = (folderId: string | null) => entries.filter((entry) => entry.folderId === folderId).sort(byTitle);
  const known = new Set(folders.map((folder) => folder.id));
  const nodesIn = (parentId: string | null): FolderNode[] =>
    folders
      .filter((folder) => folder.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((folder) => ({ folder, folders: nodesIn(folder.id), entries: entriesIn(folder.id) }));

  return {
    folders: nodesIn(null),
    // An entry whose folder is not listed still shows, at the top level.
    entries: [...entriesIn(null), ...entries.filter((entry) => entry.folderId && !known.has(entry.folderId))].sort(byTitle),
  };
}

/** Entries whose title, slug or address contain every word of `search`, ignoring case. */
export function searchEntries(entries: readonly EntrySummary[], search: string): EntrySummary[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return entries
    .filter((entry) => {
      const text = `${entry.title} ${entry.slug} ${entry.path}`.toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}
