import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { DsAlertComponent } from '@black-isle-beef/novan-design-system';
import { FieldForm, FieldFormContext } from '@novan/admin-fields';
import type { FieldDef, FieldDefOf } from '@novan/shared-schemas';

/** Where search engines cut titles and descriptions short, roughly; the previews do the same. */
export const SEARCH_TITLE_LENGTH = 60;
export const SEARCH_DESCRIPTION_LENGTH = 160;

/** The site's settings the previews fall back to (the `siteSettings` singleton). */
export interface SeoDefaults {
  siteName: string | null;
  /** The site's sharing image, as a media item id. */
  shareImageId: string | null;
}

type SeoValue = Record<string, unknown>;

/**
 * The SEO tab of the visual editor's side panel (docs/build/14-seo-site-features.md): the page's `seo` fields (the
 * same controls as the form view, with character counts), a preview of the page in search results and of the card
 * shown when it is shared. Empty fields show what the site falls back to: the page title, and the site's sharing
 * image.
 */
@Component({
  selector: 'nv-seo-panel',
  imports: [DsAlertComponent, FieldForm],
  templateUrl: './seo-panel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeoPanel {
  private readonly form = inject(FieldFormContext);

  /** The page type's `seo` group, if it has one. */
  readonly field = input<FieldDef | undefined>(undefined);
  readonly value = input<unknown>(undefined);
  readonly pageTitle = input('');
  /** The page's address on the site, e.g. `/about`. */
  readonly path = input('/');
  /** The site's address, e.g. `https://www.example.com`. */
  readonly siteUrl = input<string | null>(null);
  readonly defaults = input<SeoDefaults>({ siteName: null, shareImageId: null });

  readonly valueChange = output<SeoValue>();

  protected readonly group = computed(() => {
    const field = this.field();
    return field?.type === 'group' && !field.multiple ? (field as FieldDefOf<'group'>) : null;
  });
  protected readonly formValue = computed<SeoValue>(() => {
    const value = this.value();
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as SeoValue) : {};
  });

  protected readonly title = computed(() => {
    const own = text(this.formValue()['metaTitle']) ?? text(this.pageTitle()) ?? 'Untitled page';
    const site = text(this.defaults().siteName);
    return site && own !== site ? `${own} | ${site}` : own;
  });
  protected readonly description = computed(() => text(this.formValue()['metaDescription']));
  protected readonly hidden = computed(() => this.formValue()['noindex'] === true);
  protected readonly canonical = computed(() => text(this.formValue()['canonical']));

  /** How the address shows in results: `www.example.com › about › team`. */
  protected readonly address = computed(() => {
    const site = this.siteUrl();
    let host = 'your site';
    if (site) {
      try {
        host = new URL(site).host;
      } catch {
        // Keep the placeholder.
      }
    }
    return [host, ...this.path().split('/').filter(Boolean)].join(' › ');
  });
  protected readonly host = computed(() => this.address().split(' › ')[0].toUpperCase());

  /** The page's sharing image, else the site's, as the library shows it. */
  protected readonly image = computed(() => {
    const own = mediaId(this.formValue()['ogImage']);
    const id = own ?? this.defaults().shareImageId;
    const preview = id ? this.form.assets().get(id) : null;
    return preview?.thumbnailUrl ? { url: preview.thumbnailUrl, alt: preview.alt ?? '', fromSite: own === null } : null;
  });

  protected readonly shortTitle = computed(() => shorten(this.title(), SEARCH_TITLE_LENGTH));
  protected readonly shortDescription = computed(() => {
    const description = this.description();
    return description ? shorten(description, SEARCH_DESCRIPTION_LENGTH) : null;
  });
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function mediaId(value: unknown): string | null {
  const item = Array.isArray(value) ? value[0] : value;
  const id = typeof item === 'object' && item !== null ? (item as { assetId?: unknown }).assetId : null;
  return typeof id === 'string' ? id : null;
}

/** Cut at a word before `length` characters, with an ellipsis, as search results do. */
function shorten(value: string, length: number): string {
  const chars = [...value];
  if (chars.length <= length) return value;
  const cut = chars.slice(0, length - 1).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > length / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
