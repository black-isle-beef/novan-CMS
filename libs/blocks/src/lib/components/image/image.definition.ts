// components/image/image.definition.ts
import { defineCmsComponent } from '../../cms-registry';
import { ImageBlock } from './image.component';
import { IMAGE_SAMPLE_CONTENT, IMAGE_SCHEMA } from './image.schema';

export const IMAGE_DEFINITION = defineCmsComponent({
  type: 'image',
  name: 'Image',
  component: ImageBlock,
  fields: { image: 'media', caption: 'text' },
  settingsSchema: IMAGE_SCHEMA,
  sampleContent: IMAGE_SAMPLE_CONTENT,
});
