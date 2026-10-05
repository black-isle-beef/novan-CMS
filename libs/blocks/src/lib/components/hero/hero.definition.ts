// components/hero/hero.definition.ts — kept apart from the schema to avoid a schema → component import cycle.
import { defineCmsComponent } from '../../cms-registry';
import { HeroBlock } from './hero.component';
import { HERO_SAMPLE_CONTENT, HERO_SCHEMA } from './hero.schema';

export const HERO_DEFINITION = defineCmsComponent({
  type: 'hero',
  name: 'Hero',
  component: HeroBlock,
  fields: { heading: 'text', subheading: 'text', image: 'media', action: 'link' },
  settingsSchema: HERO_SCHEMA,
  sampleContent: HERO_SAMPLE_CONTENT,
});
