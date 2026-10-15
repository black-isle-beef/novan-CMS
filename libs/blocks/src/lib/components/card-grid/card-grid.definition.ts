// components/card-grid/card-grid.definition.ts
import { defineCmsComponent } from '../../cms-registry';
import { CardGridBlock } from './card-grid.component';
import { CARD_GRID_SAMPLE_CONTENT, CARD_GRID_SCHEMA } from './card-grid.schema';

export const CARD_GRID_DEFINITION = defineCmsComponent({
  type: 'cardGrid',
  name: 'Card grid',
  component: CardGridBlock,
  fields: {
    heading: 'text',
    intro: 'text',
    cards: { type: 'group', multiple: true, fields: { image: 'media', title: 'text', subtitle: 'text', tag: 'text' } },
  },
  settingsSchema: CARD_GRID_SCHEMA,
  sampleContent: CARD_GRID_SAMPLE_CONTENT,
});
