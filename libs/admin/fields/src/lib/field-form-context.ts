import { computed, Injectable, type Signal, signal } from '@angular/core';
import {
  ANY_LOCALE,
  type AssetKind,
  type BlockType,
  type LocaleSettings,
  localeSettings,
  type MediaAssetInfo,
  type SpaceLocale,
} from '@novan/shared-schemas';

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
  /** The space's locales (docs/build/16-localisation.md); a translated field edits one of its values at a time. */
  readonly locales = signal<readonly SpaceLocale[]>([]);
  /** The locale being edited; null for the default locale. */
  readonly locale = signal<string | null>(null);
  /** Shown read-only next to each translated field, to translate from (the side-by-side view); null for none. */
  readonly compareLocale = signal<string | null>(null);

  readonly defaultLocale = computed(() => this.locales().find((locale) => locale.isDefault)?.code ?? ANY_LOCALE.defaultLocale);
  readonly activeLocale = computed(() => this.locale() ?? this.defaultLocale());
  /** What validation needs: the default locale and every locale's code. */
  readonly localeSettings = computed<LocaleSettings>(() =>
    this.locales().length ? localeSettings(this.locales()) : ANY_LOCALE,
  );

  /** A locale's name, e.g. `French (France)`, or its code when the space does not have it. */
  localeName(code: string): string {
    return this.locales().find((locale) => locale.code === code)?.name ?? code;
  }
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

/**
 * What a part of a form edits: which locale's values of translated fields, and whether it is read-only. Provided by
 * each field's input (`nv-field-input`), so the side-by-side view can show the source locale next to the one being
 * translated. Controls with no scope above them use the {@link FieldFormContext}'s locale.
 */
export abstract class FieldScope {
  /** The locale this part shows. */
  abstract readonly scopeLocale: Signal<string>;
  /** Read-only, whatever the form allows. */
  abstract readonly scopeLocked: Signal<boolean>;
}

/** `parent.child`, or just `child` at the root. */
export function joinPath(parent: string, child: string | number): string {
  return parent ? `${parent}.${child}` : String(child);
}

/** A DOM id for the control at `path`, also the target of the error summary's links. */
export function fieldId(path: string): string {
  return `field-${path.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}
