// components/feature-grid/feature-grid.definition.ts
import { defineCmsComponent } from '../../cms-registry';
import { FeatureGridBlock } from './feature-grid.component';
import { FEATURE_GRID_SAMPLE_CONTENT, FEATURE_GRID_SCHEMA } from './feature-grid.schema';

export const FEATURE_GRID_DEFINITION = defineCmsComponent({
  type: 'featureGrid',
  name: 'Feature grid',
  component: FeatureGridBlock,
  fields: {
    heading: 'text',
    intro: 'text',
    features: { type: 'group', multiple: true, fields: { icon: 'select', title: 'text', text: 'text' } },
  },
  settingsSchema: FEATURE_GRID_SCHEMA,
  sampleContent: FEATURE_GRID_SAMPLE_CONTENT,
});
