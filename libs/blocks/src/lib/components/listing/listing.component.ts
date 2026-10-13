// components/listing/listing.component.ts — styles: src/styles/_listing.scss.
import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { type NovanBlock, NovanContentService, NovanLocale } from '@black-isle-beef/cms-angular';

import { blockId, blockText } from '../../block-text';
import { type CmsStoredSettings, modifierClasses, resolveSettings } from '../../cms-schema';
import {
  LISTING_MAX_ITEMS,
  LISTING_SCHEMA,
  LISTING_SOURCES,
  type ListingEntryData,
  type ListingFields,
  type ListingSettings,
  type ListingSource,
} from './listing.schema';

interface ListingItem {
  id: string;
  path: string;
  title: string;
  summary: string | null;
  /** `2026-03-01`, for `<time datetime>`. */
  date: string | null;
  dateLabel: string | null;
}

/** The heading level of each item's title: one below the block's heading, or the same when there is none. */
const ITEM_LEVEL = { h2: 'h3', h3: 'h4', h4: 'h5' } as const;

const DEFAULT_LIMIT = 6;

/** A stored date (`2026-03-01`, or a full timestamp) in the page's language, e.g. "1 March 2026". */
function dateLabel(date: string, locale: string | null): string {
  const value = new Date(date.length === 10 ? `${date}T00:00:00Z` : date);
  try {
    return new Intl.DateTimeFormat(locale ?? 'en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(value);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(value);
  }
}

/**
 * The newest published entries of one content type (blog posts, projects), each linking to its page. Reads the
 * Delivery API through the SDK, so the server render waits for it and its cache tags purge the page when one of the
 * entries is published. Items are a list (`ul`) so screen readers announce how many there are.
 */
@Component({
  selector: 'novan-listing-block',
  imports: [NgTemplateOutlet, RouterLink],
  templateUrl: './listing.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'hostClasses()' },
})
export class ListingBlock implements NovanBlock<ListingFields> {
  static readonly novanBlock = { apiId: 'listing', schemaVersion: 1 };

  readonly heading = input<string>();
  readonly intro = input<string>();
  readonly source = input<ListingSource | null>();
  readonly limit = input<number | null>();
  /** Raw style options. Missing or invalid values fall back to the schema defaults. */
  readonly settings = input<Partial<ListingSettings> | CmsStoredSettings | null | undefined>(undefined);

  private readonly content = inject(NovanContentService);
  private readonly locale = inject(NovanLocale);
  /** Site paths navigate with the router when the app has routes, plain links otherwise. */
  protected readonly hasRouter = inject(ActivatedRoute, { optional: true }) !== null;

  protected readonly headingId = blockId('novan-listing-block', 'heading');
  protected readonly resolved = computed(() => resolveSettings(LISTING_SCHEMA, this.settings()));
  protected readonly headingText = computed(() => blockText(this.heading()));
  protected readonly introText = computed(() => blockText(this.intro()));
  protected readonly itemLevel = computed(() => {
    const level = this.resolved().headingLevel;
    return this.headingText() ? ITEM_LEVEL[level] : level;
  });

  /** What to ask for; stored data is untrusted, so an unknown source asks for nothing. */
  private readonly query = computed(() => {
    const source: unknown = this.source();
    if (!(LISTING_SOURCES as readonly unknown[]).includes(source)) return undefined;
    const limit: unknown = this.limit();
    const count = typeof limit === 'number' && Number.isInteger(limit) ? Math.min(Math.max(limit, 1), LISTING_MAX_ITEMS) : DEFAULT_LIMIT;
    return { type: source as ListingSource, limit: count, locale: this.locale.current() };
  });

  protected readonly entries = rxResource({
    params: () => this.query(),
    stream: ({ params }) =>
      this.content.entries<ListingEntryData>({
        type: params.type,
        limit: params.limit,
        sort: '-fields.publishedOn',
        select: ['title', 'summary', 'publishedOn'],
      }),
  });

  protected readonly items = computed<ListingItem[]>(() => {
    const page = this.entries.hasValue() ? this.entries.value() : null;
    const locale = this.locale.current();
    return (page?.items ?? [])
      .filter((entry) => typeof entry.path === 'string' && entry.path.startsWith('/') && !entry.path.startsWith('//'))
      .map((entry) => {
        const date = typeof entry.data.publishedOn === 'string' && !Number.isNaN(Date.parse(entry.data.publishedOn)) ? entry.data.publishedOn : null;
        return {
          id: entry.id,
          path: entry.path,
          title: blockText(entry.data.title) ?? entry.path,
          summary: blockText(entry.data.summary),
          date: date?.slice(0, 10) ?? null,
          dateLabel: date ? dateLabel(date, locale) : null,
        };
      });
  });

  /** Loaded, and nothing is published yet: said in words rather than left as an empty box. */
  protected readonly empty = computed(() => this.query() !== undefined && this.entries.hasValue() && this.items().length === 0);

  protected readonly hostClasses = computed(() =>
    ['novan-listing-block', ...modifierClasses('novan-listing-block', LISTING_SCHEMA, this.resolved())].join(' '),
  );
}
