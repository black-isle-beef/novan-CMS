import { Injectable, signal } from '@angular/core';
import type { AssetKind, BlockType, MediaAssetInfo } from '@novan/shared-schemas';

/** What a media field shows for a file from the library. */
export interface MediaPreview {
  id: string;
  filename: string;
  title: string | null;
  kind: AssetKind;
  /** The library's alternative text, used when the page gives none of its own. */
  alt: string | null;
  /** A short-lived URL for a thumbnail, or null when there is nothing to show (documents). */
  thumbnailUrl: string | null;
}

/**
 * The media library as media fields see it; the page provides it (`@novan/admin-media`), so the field
 * controls stay free of API calls.
 */
export interface MediaSource {
  /** Opens the library to choose files; resolves with the choice, or null when cancelled. */
  choose(options: { accept: readonly AssetKind[]; multiple: boolean; label: string }): Promise<MediaPreview[] | null>;
  /** Loads previews for these ids into `FieldFormContext.assets` (null for files no longer in the library). */
  load(ids: readonly string[]): void;
}

/** An entry that reference and internal link fields can point at. */
export interface ReferenceOption {
  id: string;
  title: string;
  /** Content type api id. */
  contentType: string;
  path: string;
}

/**
 * What every field control in one form shares, however deeply nested: the environment's block types,
 * the entries references can choose from, the media library, the current validation errors (dotted path
 * to messages, as the API and `buildEntrySchema` report them) and whether the form is read-only.
 *
 * Provide one per form, on the page component that hosts it.
 */
@Injectable()
export class FieldFormContext {
  readonly blockTypes = signal<BlockType[]>([]);
  readonly entries = signal<ReferenceOption[]>([]);
  readonly errors = signal<Record<string, string[]>>({});
  readonly readonly = signal(false);
  /** The media library, when the page provides one. */
  readonly media = signal<MediaSource | null>(null);
  /** Previews of the files media fields show: null for a file no longer in the library; missing while loading. */
  readonly assets = signal<ReadonlyMap<string, MediaPreview | null>>(new Map());

  blockType(apiId: string): BlockType | undefined {
    return this.blockTypes().find((type) => type.apiId === apiId);
  }

  /**
   * What `buildEntrySchema` needs to check media items against the library: `undefined` while a preview
   * is still loading, so only the API decides about files the form has not seen yet.
   */
  assetInfo(id: string): MediaAssetInfo | null | undefined {
    const preview = this.assets().get(id);
    return preview === undefined ? undefined : preview && { kind: preview.kind, alt: preview.alt };
  }

  /** Whether there are errors at `path` or inside it (for example a field inside a collapsed block). */
  hasErrorsWithin(path: string): boolean {
    return Object.keys(this.errors()).some((key) => key === path || key.startsWith(`${path}.`));
  }
}

/** `parent.child`, or just `child` at the root. */
export function joinPath(parent: string, child: string | number): string {
  return parent ? `${parent}.${child}` : String(child);
}

/** A DOM id for the control at `path`, also the target of the error summary's links. */
export function fieldId(path: string): string {
  return `field-${path.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}
