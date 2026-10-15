// components/badge-list/badge-list.schema.ts
import type { CmsStyleSchema } from '../../cms-schema';

export interface BadgeListSettings {
  tone: 'light' | 'brand' | 'dark';
  alignment: 'start' | 'center';
  headingLevel: 'h2' | 'h3' | 'h4';
}

export interface Badge {
  label: string;
}

/** The `badgeList` block type's fields (libs/blocks/block-types.json). */
export interface BadgeListFields {
  heading: string;
  intro: string;
  badges: Badge[] | null;
}

export const BADGE_LIST_SCHEMA: CmsStyleSchema<BadgeListSettings> = {
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
  alignment: {
    kind: 'radio',
    label: 'Alignment',
    options: [
      { value: 'start', label: 'Left' },
      { value: 'center', label: 'Centre' },
    ],
    default: 'start',
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

export const BADGE_LIST_SAMPLE_CONTENT: BadgeListFields = {
  heading: 'Qualified and trusted',
  intro: 'The training and memberships behind every groom.',
  badges: [{ label: 'City & Guilds Level 3 dog grooming' }, { label: 'Pet first aid' }, { label: 'Fully insured' }],
};
