// components/hero/hero.schema.ts
import type { NovanAsset, NovanLinkValue } from '@black-isle-beef/cms-angular';

import type { CmsStyleSchema } from '../../cms-schema';

export interface HeroSettings {
  tone: 'light' | 'brand' | 'dark';
  alignment: 'start' | 'center';
  height: 'compact' | 'standard' | 'tall';
  headingLevel: 'h1' | 'h2';
}

/** The `hero` block type's fields (supabase/seed.sql). */
export interface HeroFields {
  heading: string;
  subheading: string;
  /** Shown behind the text, under a tinted layer that keeps the text readable. */
  image: NovanAsset | null;
  action: NovanLinkValue | null;
}

export const HERO_SCHEMA: CmsStyleSchema<HeroSettings> = {
  tone: {
    kind: 'radio',
    label: 'Tone',
    hint: 'Background and text colours.',
    options: [
      { value: 'light', label: 'Light' },
      { value: 'brand', label: 'Brand' },
      { value: 'dark', label: 'Dark' },
    ],
    default: 'brand',
  },
  alignment: {
    kind: 'radio',
    label: 'Alignment',
    options: [
      { value: 'start', label: 'Left' },
      { value: 'center', label: 'Centre' },
    ],
    default: 'start',
  },
  height: {
    kind: 'select',
    label: 'Height',
    options: [
      { value: 'compact', label: 'Compact' },
      { value: 'standard', label: 'Standard' },
      { value: 'tall', label: 'Tall' },
    ],
    default: 'standard',
  },
  headingLevel: {
    kind: 'select',
    label: 'Heading level',
    hint: 'Use H1 only for the first block on a page.',
    options: [
      { value: 'h1', label: 'H1' },
      { value: 'h2', label: 'H2' },
    ],
    default: 'h1',
  },
};

export const HERO_SAMPLE_CONTENT: HeroFields = {
  heading: 'Grooming that puts your dog first',
  subheading: 'Calm, unhurried appointments in a quiet salon, with a photo report when your dog is ready to go home.',
  image: null,
  action: { type: 'external', url: 'https://example.com/book', text: 'Book an appointment' },
};
