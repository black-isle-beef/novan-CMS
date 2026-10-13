// components/listing/listing.schema.ts
import type { CmsStyleSchema } from '../../cms-schema';

export interface ListingSettings {
  columns: 'two' | 'three';
  tone: 'light' | 'brand' | 'dark';
  headingLevel: 'h2' | 'h3' | 'h4';
}

/**
 * The content types a listing can show (the `source` select's options). Each is a page type with `title`, `summary`
 * and `publishedOn` fields: the blog kit's `post` and the portfolio kit's `project` (kits/).
 */
export const LISTING_SOURCES = ['post', 'project'] as const;
export type ListingSource = (typeof LISTING_SOURCES)[number];

/** The most items a listing shows. */
export const LISTING_MAX_ITEMS = 12;

/** The `listing` block type's fields (libs/blocks/block-types.json). */
export interface ListingFields {
  heading: string;
  intro: string;
  source: ListingSource | null;
  /** How many to show, newest first; 6 when empty. */
  limit: number | null;
}

/** What the listing reads of each entry. */
export interface ListingEntryData {
  title?: unknown;
  summary?: unknown;
  publishedOn?: unknown;
}

export const LISTING_SCHEMA: CmsStyleSchema<ListingSettings> = {
  columns: {
    kind: 'radio',
    label: 'Columns',
    options: [
      { value: 'two', label: '2' },
      { value: 'three', label: '3' },
    ],
    default: 'three',
  },
  tone: {
    kind: 'radio',
    label: 'Tone',
    hint: 'Background and text colours.',
    options: [
      { value: 'light', label: 'Light' },
      { value: 'brand', label: 'Brand' },
      { value: 'dark', label: 'Dark' },
    ],
    default: 'light',
  },
  headingLevel: {
    kind: 'select',
    label: 'Heading level',
    hint: 'Keep headings in order on the page.',
    options: [
      { value: 'h2', label: 'H2' },
      { value: 'h3', label: 'H3' },
      { value: 'h4', label: 'H4' },
    ],
    default: 'h2',
  },
};

export const LISTING_SAMPLE_CONTENT: ListingFields = {
  heading: 'Latest from the salon',
  intro: 'Grooming tips, new services and news from our team.',
  source: 'post',
  limit: 3,
};
