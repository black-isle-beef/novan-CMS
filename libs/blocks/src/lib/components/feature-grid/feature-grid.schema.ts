// components/feature-grid/feature-grid.schema.ts
import type { CmsStyleSchema } from '../../cms-schema';

export interface FeatureGridSettings {
  columns: 'two' | 'three' | 'four';
  tone: 'light' | 'brand' | 'dark';
  headingLevel: 'h2' | 'h3' | 'h4';
}

/** The icons editors can pick (the `icon` select's options), as Bootstrap Icons names. */
export const FEATURE_ICONS = ['check-circle', 'star', 'lightning', 'shield-check', 'heart', 'chat-dots'] as const;
export type FeatureIcon = (typeof FEATURE_ICONS)[number];

export interface Feature {
  icon?: FeatureIcon | null;
  title: string;
  text?: string | null;
}

/** The `featureGrid` block type's fields (supabase/seed.sql). */
export interface FeatureGridFields {
  heading: string;
  intro: string;
  features: Feature[] | null;
}

export const FEATURE_GRID_SCHEMA: CmsStyleSchema<FeatureGridSettings> = {
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

export const FEATURE_GRID_SAMPLE_CONTENT: FeatureGridFields = {
  heading: 'Why owners choose us',
  intro: 'Small touches that make grooming day easier for you and your dog.',
  features: [
    { icon: 'heart', title: 'Calm handling', text: 'Breaks whenever your dog needs one, and never more than one dog at a time.' },
    { icon: 'shield-check', title: 'Fully insured', text: 'Qualified groomers, with first-aid training renewed every year.' },
    { icon: 'chat-dots', title: 'Photo updates', text: 'A message and photos as soon as your dog is ready.' },
  ],
};
