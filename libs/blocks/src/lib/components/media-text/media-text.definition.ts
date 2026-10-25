// components/media-text/media-text.definition.ts
import { defineCmsComponent } from '../../cms-registry';
import { MediaTextBlock } from './media-text.component';
import { MEDIA_TEXT_SAMPLE_CONTENT, MEDIA_TEXT_SCHEMA } from './media-text.schema';

export const MEDIA_TEXT_DEFINITION = defineCmsComponent({
  type: 'mediaText',
  name: 'Image and text',
  component: MediaTextBlock,
  fields: { heading: 'text', text: 'text', image: 'media', action: 'link' },
  settingsSchema: MEDIA_TEXT_SCHEMA,
  sampleContent: MEDIA_TEXT_SAMPLE_CONTENT,
  parts: ['root', 'inner', 'body', 'heading', 'text', 'action', 'media', 'image'],
});
