// components/card-grid/card-grid.schema.ts
import type { NovanAsset } from '@black-isle-beef/cms-angular';

import type { CmsStyleSchema } from '../../cms-schema';

export interface CardGridSettings {
  columns: 'two' | 'three' | 'four';
  tone: 'light' | 'brand' | 'dark';
  headingLevel: 'h2' | 'h3' | 'h4';
}

export interface Card {
  /** Its `alt` is the page's own alt text, else the media library's; none means decorative. */
  image?: NovanAsset | null;
  title: string;
  subtitle?: string | null;
  /** A short label shown as a badge, like the service given. */
  tag?: string | null;
}

/** The `cardGrid` block type's fields (libs/blocks/block-types.json). */
export interface CardGridFields {
  heading: string;
  intro: string;
  cards: Card[] | null;
}

export const CARD_GRID_SCHEMA: CmsStyleSchema<CardGridSettings> = {
  columns: {
    kind: 'radio',
    label: 'Columns',
    options: [
      { value: 'two', label: '2' },
      { value: 'three', label: '3' },
      { value: 'four', label: '4' },
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

const samplePhoto = (n: number, alt: string): NovanAsset => ({
  id: `00000000-0000-4000-8000-00000000001${n}`,
  url: `/v1/assets/00000000-0000-4000-8000-00000000001${n}/dog-${n}.jpg`,
  filename: `dog-${n}.jpg`,
  mime: 'image/jpeg',
  width: 1200,
  height: 900,
  alt,
  focal: null,
});

export const CARD_GRID_SAMPLE_CONTENT: CardGridFields = {
  heading: 'Recently pampered',
  intro: 'A few of the dogs and small animals we have groomed lately.',
  cards: [
    {
      image: samplePhoto(1, 'A cockapoo with a freshly trimmed teddy-bear face'),
      title: 'Bramble',
      subtitle: 'Cockapoo',
      tag: 'Full groom',
    },
    {
      image: samplePhoto(2, 'A lop-eared rabbit sitting on a grooming table'),
      title: 'Clover',
      subtitle: 'Lop rabbit',
      tag: 'Nail trim',
    },
    {
      image: samplePhoto(3, 'A greyhound in a blue towel after a bath'),
      title: 'Juno',
      subtitle: 'Greyhound',
      tag: 'Bath and brush',
    },
  ],
};
