// components/custom-html/custom-html.definition.ts
import { defineCmsComponent } from '../../cms-registry';
import { CustomHtmlBlock } from './custom-html.component';
import { CUSTOM_HTML_SAMPLE_CONTENT, CUSTOM_HTML_SCHEMA } from './custom-html.schema';

export const CUSTOM_HTML_DEFINITION = defineCmsComponent({
  type: 'customHtml',
  name: 'Custom HTML',
  component: CustomHtmlBlock,
  fields: { html: 'text', css: 'text' },
  settingsSchema: CUSTOM_HTML_SCHEMA,
  sampleContent: CUSTOM_HTML_SAMPLE_CONTENT,
  parts: ['root', 'inner', 'content'],
});
