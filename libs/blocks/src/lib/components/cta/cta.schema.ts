// components/cta/cta.schema.ts
import type { NovanLinkValue } from '@black-isle-beef/cms-angular';

import type { CmsStyleSchema } from '../../cms-schema';

export interface CtaSettings {
  tone: 'light' | 'brand' | 'dark';
  alignment: 'start' | 'center';
  headingLevel: 'h2' | 'h3' | 'h4';
}

/** The `cta` block type's fields (supabase/seed.sql). */
export interface CtaFields {
  heading: string;
  text: string;
  /** A page, a web address or an email address. */
  action: NovanLinkValue | null;
}

export const CTA_SCHEMA: CmsStyleSchema<CtaSettings> = {
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
    default: 'center',
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

export const CTA_SAMPLE_CONTENT: CtaFields = {
  heading: 'Ready for a calmer grooming day?',
  text: 'Tell us about your dog and we will suggest the right appointment.',
  action: { type: 'email', email: 'hello@example.com', text: 'Email us' },
};
