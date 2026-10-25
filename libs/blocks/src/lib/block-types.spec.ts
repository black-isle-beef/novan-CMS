// block-types.spec.ts — each block component against its block type in the library's manifest (block-types.json, what
// `novan blocks sync` pushes to spaces), and the demo seed (supabase/seed.sql) against the manifest, so the component's
// inputs, the field definitions and the style options cannot drift apart.
import { reflectComponentType } from '@angular/core';
import { PART_NAME, ROOT_PART } from '@black-isle-beef/cms-angular';

import { manifestBlockTypes } from '../testing/block-manifest';
import { seededBlockTypes, type SeededField } from '../testing/seeded-block-types';
import type { CmsFieldSpec } from './cms-registry';
import { CMS_COMPONENT_DEFINITIONS } from './cms-components';
import { novanBlocks } from './novan-blocks';

/** The component's input names, as templates (and `<novan-blocks>`) use them. */
const inputsOf = (component: Parameters<typeof reflectComponentType>[0]) =>
  (reflectComponentType(component)?.inputs ?? []).map((input) => input.templateName).sort();

/** The compiled shape of a component, as far as these checks read it: static attributes and child components. */
interface CompiledComponent {
  hostAttrs?: unknown[] | null;
  consts?: unknown[] | (() => unknown[]) | null;
  dependencies?: unknown[] | (() => unknown[]) | null;
}

const compiled = (type: unknown): CompiledComponent | undefined =>
  // ɵcmp is Angular's compiled definition; read here only so the check covers every branch of the template.
  (type as { ɵcmp?: CompiledComponent } | null)?.ɵcmp;

/** Every `data-novan-part` written in a component's template or host, and in the components it uses. */
function markedParts(type: unknown, seen = new Set<unknown>()): Set<string> {
  const parts = new Set<string>();
  const definition = compiled(type);
  if (!definition || seen.has(type)) return parts;
  seen.add(type);
  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    value.forEach((item, index) => {
      if (item === 'data-novan-part' && typeof value[index + 1] === 'string') parts.add(value[index + 1] as string);
      visit(item);
    });
  };
  visit(definition.hostAttrs);
  visit(typeof definition.consts === 'function' ? definition.consts() : definition.consts);
  const dependencies = typeof definition.dependencies === 'function' ? definition.dependencies() : definition.dependencies;
  for (const dependency of dependencies ?? []) markedParts(dependency, seen).forEach((part) => parts.add(part));
  return parts;
}

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
  it('reads the ten block types of the manifest', () => {
    expect(blockTypes.map((type) => type.apiId).sort()).toEqual([
      'badgeList',
      'cardGrid',
      'cta',
      'featureGrid',
      'form',
      'hero',
      'image',
      'listing',
      'mediaText',
      'richText',
    ]);
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

    it('names its parts once each, starting with the root', () => {
      expect(definition.parts[0]).toBe(ROOT_PART);
      expect(new Set(definition.parts).size).toBe(definition.parts.length);
      for (const part of definition.parts) expect(part).toMatch(PART_NAME);
    });

    it('marks exactly its declared parts in its template, with the root on the host', () => {
      expect(compiled(definition.component)?.hostAttrs).toEqual(expect.arrayContaining(['data-novan-part', ROOT_PART]));
      expect([...markedParts(definition.component)].sort()).toEqual([...definition.parts].sort());
    });
  });
});
