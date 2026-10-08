import type { MediaAssetInfo, MediaRef } from '@novan/shared-schemas';
import type { PageHeading } from '@novan/shared-types';

/** One thing to look at before publishing. Errors stop publishing; warnings are advice. */
export interface CheckItem {
  severity: 'error' | 'warning';
  /** What is wrong, in plain words, naming the field or heading. */
  message: string;
  /** The block it is in, so the editor can go to it; null for the page's own fields or the site's layout. */
  uid: string | null;
}

/**
 * The pre-publish checklist (docs/build/12-visual-editor.md, 12c): validation errors that would stop publishing
 * (missing required fields, required alternative text and the rest of `buildEntrySchema`), images with no
 * alternative text anywhere, and heading order on the page as the site draws it. Errors come first.
 */
export function pageChecks(input: {
  /** Publish validation errors: dotted data path to messages. */
  errors: Readonly<Record<string, readonly string[]>>;
  /** A readable name for a data path (`describePath`). */
  describe: (path: string) => string;
  /** The `_uid` of the block a data path is in, or null. */
  blockAt: (path: string) => string | null;
  /** Media items in the page (`mediaRefs`), with their files as far as they are known. */
  media: readonly MediaRef[];
  asset: (assetId: string) => MediaAssetInfo | null | undefined;
  /** Readable name for a media item's path, whose blocks are named by `_uid`. */
  describeMedia: (ref: MediaRef) => { label: string; uid: string | null };
  /** The page's headings, once the site has drawn them. */
  headings: readonly PageHeading[] | null;
}): CheckItem[] {
  const items: CheckItem[] = [];
  for (const [path, messages] of Object.entries(input.errors)) {
    for (const message of messages) items.push({ severity: 'error', message: `${input.describe(path)}: ${message}`, uid: input.blockAt(path) });
  }
  for (const ref of input.media) {
    const asset = input.asset(ref.assetId);
    // Required alt text is an error above; a file not loaded yet, or not an image, is not checked.
    if (ref.requireAlt || !asset || asset.kind !== 'image' || ref.alt?.trim() || asset.alt?.trim()) continue;
    const { label, uid } = input.describeMedia(ref);
    items.push({
      severity: 'warning',
      message: `${label}: the image has no alternative text, so screen readers skip it. Add some unless it is only decoration.`,
      uid,
    });
  }
  items.push(...headingChecks(input.headings ?? []));
  return items.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}

/** Heading order advice: one main heading (H1), and no levels skipped on the way down. */
export function headingChecks(headings: readonly PageHeading[]): CheckItem[] {
  if (!headings.length) return [];
  const items: CheckItem[] = [];
  const mains = headings.filter((heading) => heading.level === 1);
  if (!mains.length) {
    items.push({ severity: 'warning', message: 'The page has no main heading (H1). Give its first block an H1.', uid: headings[0].uid });
  } else if (mains.length > 1) {
    items.push({
      severity: 'warning',
      message: `The page has ${mains.length} main headings (H1). Keep one, and make the others H2.`,
      uid: mains[1].uid,
    });
  }
  let previous = 0;
  for (const heading of headings) {
    if (previous && heading.level > previous + 1) {
      items.push({
        severity: 'warning',
        message: `“${heading.text || 'A heading'}” is an H${heading.level} after an H${previous}, skipping a level. Use an H${previous + 1}.`,
        uid: heading.uid,
      });
    }
    previous = heading.level;
  }
  return items;
}
