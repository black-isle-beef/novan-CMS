// components/rich-text/rich-text.definition.ts
import { defineCmsComponent } from '../../cms-registry';
import { RichTextBlock } from './rich-text.component';
import { RICH_TEXT_SAMPLE_CONTENT, RICH_TEXT_SCHEMA } from './rich-text.schema';

export const RICH_TEXT_DEFINITION = defineCmsComponent({
  type: 'richText',
  name: 'Rich text',
  component: RichTextBlock,
  fields: { body: 'richText' },
  settingsSchema: RICH_TEXT_SCHEMA,
  sampleContent: RICH_TEXT_SAMPLE_CONTENT,
});
