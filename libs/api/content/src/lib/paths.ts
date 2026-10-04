import { cacheTag } from '@novan/api-common';

/** An entry's address: its folder's path (none for the top level) and its slug. */
export function entryPath(folderPath: string | null, slug: string): string {
  return `${folderPath ?? ''}/${slug}`;
}

/** The last part of an address: `/blog/hello` gives `hello`. */
export function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Cache tags of a published entry, purged when it changes (package 08). */
export function cacheTags(entry: { id: string; environmentId: string; contentType: string }): string[] {
  return [cacheTag.entry(entry.id), cacheTag.type(entry.environmentId, entry.contentType)];
}
