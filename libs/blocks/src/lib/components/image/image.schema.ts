// components/image/image.schema.ts
import type { NovanAsset } from '@black-isle-beef/cms-angular';

import type { CmsStyleSchema } from '../../cms-schema';

export interface ImageSettings {
  width: 'narrow' | 'wide' | 'full';
  rounded: boolean;
}

/** The `image` block type's fields (supabase/seed.sql). */
export interface ImageFields {
  /** Its `alt` is the page's own alt text, else the media library's; none means decorative. */
  image: NovanAsset | null;
  caption: string;
}

export const IMAGE_SCHEMA: CmsStyleSchema<ImageSettings> = {
  width: {
    kind: 'select',
    label: 'Width',
    options: [
      { value: 'narrow', label: 'Narrow' },
      { value: 'wide', label: 'Wide' },
      { value: 'full', label: 'Full width' },
    ],
    default: 'wide',
  },
  rounded: { kind: 'toggle', label: 'Rounded corners', default: false },
};

export const IMAGE_SAMPLE_CONTENT: ImageFields = {
  image: {
    id: '00000000-0000-4000-8000-000000000000',
    url: '/v1/assets/00000000-0000-4000-8000-000000000000/salon.jpg',
    filename: 'salon.jpg',
    mime: 'image/jpeg',
    width: 1600,
    height: 900,
    alt: 'The grooming salon, with a bath and two grooming tables',
    focal: null,
  },
  caption: 'Our salon on the high street.',
};
