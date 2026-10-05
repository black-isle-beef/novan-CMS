// components/cta/cta.definition.ts
import { defineCmsComponent } from '../../cms-registry';
import { CtaBlock } from './cta.component';
import { CTA_SAMPLE_CONTENT, CTA_SCHEMA } from './cta.schema';

export const CTA_DEFINITION = defineCmsComponent({
  type: 'cta',
  name: 'Call to action',
  component: CtaBlock,
  fields: { heading: 'text', text: 'text', action: 'link' },
  settingsSchema: CTA_SCHEMA,
  sampleContent: CTA_SAMPLE_CONTENT,
});
