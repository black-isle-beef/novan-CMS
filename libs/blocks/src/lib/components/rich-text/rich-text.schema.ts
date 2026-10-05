// components/rich-text/rich-text.schema.ts
import type { ProseMirrorNode } from '@black-isle-beef/cms-angular';

import type { CmsStyleSchema } from '../../cms-schema';

export interface RichTextSettings {
  width: 'narrow' | 'wide';
  tone: 'light' | 'brand' | 'dark';
}

/** The `richText` block type's fields (supabase/seed.sql). */
export interface RichTextFields {
  /** ProseMirror JSON from the editor. Headings inside it are the editor's to keep in order. */
  body: ProseMirrorNode | null;
}

export const RICH_TEXT_SCHEMA: CmsStyleSchema<RichTextSettings> = {
  width: {
    kind: 'radio',
    label: 'Width',
    options: [
      { value: 'narrow', label: 'Narrow' },
      { value: 'wide', label: 'Wide' },
    ],
    default: 'narrow',
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
};

export const RICH_TEXT_SAMPLE_CONTENT: RichTextFields = {
  body: {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'How we work' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Every appointment starts with a ' },
          { type: 'text', text: 'ten-minute settling-in', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' period, so your dog meets us before the clippers come out. Read our ' },
          { type: 'text', text: 'grooming guide', marks: [{ type: 'link', attrs: { href: '/guide' } }] },
          { type: 'text', text: '.' },
        ],
      },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One dog in the salon at a time' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hypoallergenic shampoos' }] }] },
        ],
      },
    ],
  },
};
