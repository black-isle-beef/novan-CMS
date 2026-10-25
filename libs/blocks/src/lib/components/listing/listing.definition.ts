// components/listing/listing.definition.ts
import { defineCmsComponent } from '../../cms-registry';
import { ListingBlock } from './listing.component';
import { LISTING_SAMPLE_CONTENT, LISTING_SCHEMA } from './listing.schema';

export const LISTING_DEFINITION = defineCmsComponent({
  type: 'listing',
  name: 'Listing',
  component: ListingBlock,
  fields: { heading: 'text', intro: 'text', source: 'select', limit: 'number' },
  settingsSchema: LISTING_SCHEMA,
  sampleContent: LISTING_SAMPLE_CONTENT,
  parts: ['root', 'inner', 'heading', 'intro', 'list', 'item', 'title', 'date', 'summary'],
});
