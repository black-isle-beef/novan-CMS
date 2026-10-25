// components/form/form.definition.ts
import { defineCmsComponent } from '../../cms-registry';
import { FormBlock } from './form.component';
import { FORM_SAMPLE_CONTENT, FORM_SCHEMA } from './form.schema';

export const FORM_DEFINITION = defineCmsComponent({
  type: 'form',
  name: 'Form',
  component: FormBlock,
  fields: {
    heading: 'text',
    intro: 'text',
    fields: {
      type: 'group',
      multiple: true,
      fields: { label: 'text', name: 'text', type: 'select', required: 'boolean', help: 'text', options: 'text' },
    },
    submitLabel: 'text',
    successMessage: 'text',
  },
  settingsSchema: FORM_SCHEMA,
  sampleContent: FORM_SAMPLE_CONTENT,
  parts: ['root', 'inner', 'heading', 'intro', 'form', 'field', 'submit'],
});
