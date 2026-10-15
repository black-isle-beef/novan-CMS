// components/media-text/media-text.schema.ts
import type { NovanAsset, NovanLinkValue } from '@black-isle-beef/cms-angular';

import type { CmsStyleSchema } from '../../cms-schema';

export interface MediaTextSettings {
  tone: 'light' | 'brand' | 'dark';
  imagePosition: 'start' | 'end';
  headingLevel: 'h2' | 'h3' | 'h4';
}

/** The `mediaText` block type's fields (libs/blocks/block-types.json). */
export interface MediaTextFields {
  heading: string;
  /** Plain text; a blank line starts a new paragraph. */
  text: string;
  /** Its `alt` is the page's own alt text, else the media library's; none means decorative. */
  image: NovanAsset | null;
  /** A page, a web address or an email address. */
  action: NovanLinkValue | null;
}

export const MEDIA_TEXT_SCHEMA: CmsStyleSchema<MediaTextSettings> = {
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
  imagePosition: {
    kind: 'radio',
    label: 'Image side',
    hint: 'On small screens the image sits below the text.',
    options: [
      { value: 'start', label: 'Left' },
      { value: 'end', label: 'Right' },
    ],
    default: 'end',
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

export const MEDIA_TEXT_SAMPLE_CONTENT: MediaTextFields = {
  heading: 'Every groom ends with a report',
  text: 'After every appointment you get a private link to your dog’s own report.\n\nPhotos, the care we gave, and simple notes for looking after them at home.',
  image: {
    id: '00000000-0000-4000-8000-000000000001',
    url: '/v1/assets/00000000-0000-4000-8000-000000000001/report.jpg',
    filename: 'report.jpg',
    mime: 'image/jpeg',
    width: 1200,
    height: 900,
    alt: 'A grooming report open on a phone, with photos of a freshly groomed spaniel',
    focal: null,
  },
  action: {
    type: 'internal',
    entryId: '00000000-0000-4000-8000-000000000002',
    path: '/gallery',
    text: 'See our gallery',
  },
};
