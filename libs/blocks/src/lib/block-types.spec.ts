// block-types.spec.ts — each block component against its block type in the library's manifest (block-types.json, what
// `novan blocks sync` pushes to spaces), and the demo seed (supabase/seed.sql) against the manifest, so the component's
// inputs, the field definitions and the style options cannot drift apart.
import { reflectComponentType } from '@angular/core';

import { manifestBlockTypes } from '../testing/block-manifest';
import { seededBlockTypes, type SeededField } from '../testing/seeded-block-types';
import type { CmsFieldSpec } from './cms-registry';
import { CMS_COMPONENT_DEFINITIONS } from './cms-components';
import { novanBlocks } from './novan-blocks';

/** The component's input names, as templates (and `<novan-blocks>`) use them. */
const inputsOf = (component: Parameters<typeof reflectComponentType>[0]) =>
  (reflectComponentType(component)?.inputs ?? []).map((input) => input.templateName).sort();

/** A block type's field list in the shape of a definition's `fields`. */
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

const blockTypes = manifestBlockTypes();

describe('blocks and their block types', () => {
  it('reads the seven block types of the manifest', () => {
    expect(blockTypes.map((type) => type.apiId).sort()).toEqual(['cta', 'featureGrid', 'form', 'hero', 'image', 'listing', 'richText']);
  });

  it('lists the block types in the order an editor lists the blocks', () => {
    expect(blockTypes.map((type) => type.apiId)).toEqual(CMS_COMPONENT_DEFINITIONS.map((definition) => definition.type));
  });

  it('seeds the demo space with block types exactly as the manifest has them', () => {
    for (const type of seededBlockTypes()) {
      const manifest = blockTypes.find((candidate) => candidate.apiId === type.apiId);
      expect(manifest && { apiId: manifest.apiId, name: manifest.name, icon: manifest.icon, fields: manifest.fields, styleOptions: manifest.styleOptions }).toEqual(type);
    }
  });

  it('has one block for every block type, and no others', () => {
    expect(CMS_COMPONENT_DEFINITIONS.map((definition) => definition.type).sort()).toEqual(blockTypes.map((type) => type.apiId).sort());
    expect([...novanBlocks.keys()].sort()).toEqual(blockTypes.map((type) => type.apiId).sort());
  });

  describe.each(CMS_COMPONENT_DEFINITIONS.map((definition) => [definition.type, definition] as const))('%s', (apiId, definition) => {
    const type = blockTypes.find((candidate) => candidate.apiId === apiId);

    it('is the registered component, declared for this block type', () => {
      expect(novanBlocks.get(apiId)).toBe(definition.component);
      expect(definition.component.novanBlock.apiId).toBe(apiId);
    });

    it('has the name of its block type', () => {
      expect(definition.name).toBe(type?.name);
    });

    it('declares one input per field, plus settings', () => {
      expect(inputsOf(definition.component)).toEqual([...(type?.fields ?? []).map((field) => field.apiId), 'settings'].sort());
    });

    it('expects the field types, including inside groups', () => {
      expect(definition.fields).toEqual(specOf(type?.fields ?? []));
    });

    it('offers exactly the style options of its block type', () => {
      expect(definition.settingsSchema).toEqual(type?.styleOptions);
    });

    it('has sample content for every field', () => {
      expect(Object.keys(definition.sampleContent).sort()).toEqual(Object.keys(definition.fields).sort());
    });
  });
});
