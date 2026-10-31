// components/custom-html/custom-html.schema.ts
import type { CmsStyleSchema } from '../../cms-schema';

export interface CustomHtmlSettings {
  width: 'contained' | 'full';
}

/** The `customHtml` block type's fields (block-types.json). */
export interface CustomHtmlFields {
  /** Markup, sanitised as it renders: no scripts, event handlers, frames, forms, ids or `style` attributes. */
  html: string | null;
  /**
   * Styles for this block only. Published, they go in the site's stylesheet (`GET /v1/site-css`), scoped to the block;
   * in preview the block adds them to the page itself, so the editor sees changes before they are saved.
   */
  css: string | null;
}

export const CUSTOM_HTML_SCHEMA: CmsStyleSchema<CustomHtmlSettings> = {
  width: {
    kind: 'radio',
    label: 'Width',
    hint: 'Contained lines the block up with the page; full width runs edge to edge.',
    options: [
      { value: 'contained', label: 'Contained' },
      { value: 'full', label: 'Full width' },
    ],
    default: 'contained',
  },
};

export const CUSTOM_HTML_SAMPLE_CONTENT: CustomHtmlFields = {
  html: [
    '<div class="opening-hours">',
    '  <h2>Opening hours</h2>',
    '  <dl>',
    '    <dt>Monday to Friday</dt><dd>9am to 6pm</dd>',
    '    <dt>Saturday</dt><dd>9am to 1pm</dd>',
    '  </dl>',
    '</div>',
  ].join('\n'),
  css: ['.opening-hours dl { display: grid; grid-template-columns: auto 1fr; gap: 0.5rem 2rem; }', '.opening-hours dd { margin: 0; }'].join('\n'),
};
