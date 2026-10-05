// block-types.spec.ts — each block component against the block type seeded for it (supabase/seed.sql), so the
// component's inputs, the field definitions and the style options cannot drift apart.
import { reflectComponentType } from '@angular/core';

import { seededBlockTypes, type SeededField } from '../testing/seeded-block-types';
import type { CmsFieldSpec } from './cms-registry';
import { CMS_COMPONENT_DEFINITIONS } from './cms-components';
import { novanBlocks } from './novan-blocks';

/** The component's input names, as templates (and `<novan-blocks>`) use them. */
const inputsOf = (component: Parameters<typeof reflectComponentType>[0]) =>
  (reflectComponentType(component)?.inputs ?? []).map((input) => input.templateName).sort();

/** The seeded field list in the shape of a definition's `fields`. */
function specOf(fields: SeededField[]): Record<string, CmsFieldSpec> {
  return Object.fromEntries(
    fields.map((field) => [
      field.apiId,
      field.type === 'group'
        ? { type: 'group', multiple: field.multiple === true, fields: specOf(field.fields ?? []) }
        : (field.type as CmsFieldSpec),
    ]),
  );
}

const seeded = seededBlockTypes();

describe('blocks and their seeded block types', () => {
  it('reads the five seeded block types', () => {
    expect(seeded.map((type) => type.apiId).sort()).toEqual(['cta', 'featureGrid', 'hero', 'image', 'richText']);
  });

  it('has one block for every seeded block type, and no others', () => {
    expect(CMS_COMPONENT_DEFINITIONS.map((definition) => definition.type).sort()).toEqual(seeded.map((type) => type.apiId).sort());
    expect([...novanBlocks.keys()].sort()).toEqual(seeded.map((type) => type.apiId).sort());
  });

  describe.each(CMS_COMPONENT_DEFINITIONS.map((definition) => [definition.type, definition] as const))('%s', (apiId, definition) => {
    const type = seeded.find((candidate) => candidate.apiId === apiId);

    it('is the registered component, declared for this block type', () => {
      expect(novanBlocks.get(apiId)).toBe(definition.component);
      expect(definition.component.novanBlock.apiId).toBe(apiId);
    });

    it('has the seeded name', () => {
      expect(definition.name).toBe(type?.name);
    });

    it('declares one input per seeded field, plus settings', () => {
      expect(inputsOf(definition.component)).toEqual([...(type?.fields ?? []).map((field) => field.apiId), 'settings'].sort());
    });

    it('expects the seeded field types, including inside groups', () => {
      expect(definition.fields).toEqual(specOf(type?.fields ?? []));
    });

    it('offers exactly the seeded style options', () => {
      expect(definition.settingsSchema).toEqual(type?.styleOptions);
    });

    it('has sample content for every field', () => {
      expect(Object.keys(definition.sampleContent).sort()).toEqual(Object.keys(definition.fields).sort());
    });
  });
});
