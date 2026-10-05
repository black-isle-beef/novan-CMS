// cms-registry.ts — what each block is: its block type api id, editor name, component, fields, style options
// and sample content. `<novan-blocks>` renders from `novanBlocks`; the editor panel and tests read these.
import { type EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import type { NovanBlockType } from '@black-isle-beef/cms-angular';

import type { CmsStyleSchema } from './cms-schema';

/** A field type, as in the block type's field definitions (docs/build/05-content-modelling.md). */
export type CmsFieldType =
  | 'text'
  | 'richText'
  | 'number'
  | 'boolean'
  | 'date'
  | 'select'
  | 'media'
  | 'link'
  | 'reference'
  | 'blocks'
  | 'json';

/** What the component expects of one field; `block-types.spec.ts` compares it with the seeded definition. */
export type CmsFieldSpec =
  | CmsFieldType
  | { readonly type: 'group'; readonly multiple: boolean; readonly fields: Readonly<Record<string, CmsFieldSpec>> };

export interface CmsComponentDefinition<TSettings = unknown, TContent extends object = object> {
  /** The block type's api id, stored as `_block`. Never rename once content exists; add a new type instead. */
  readonly type: string;
  /** Name shown to content editors. */
  readonly name: string;
  readonly component: NovanBlockType;
  /** One entry per field, each an `input()` of the component with the same name. */
  readonly fields: { readonly [K in keyof TContent]-?: CmsFieldSpec };
  readonly settingsSchema: CmsStyleSchema<TSettings>;
  /** Realistic field values, used by the editor preview and tests. */
  readonly sampleContent: TContent;
}

/** A definition of whatever shape; the registry and editor panel hold many. */
export type AnyCmsComponentDefinition = CmsComponentDefinition<unknown, object>;

/** Typed helper so each definition is checked against its own settings and content types. */
export function defineCmsComponent<TSettings, TContent extends object>(
  definition: CmsComponentDefinition<TSettings, TContent>,
): CmsComponentDefinition<TSettings, TContent> {
  return definition;
}

export const CMS_COMPONENTS = new InjectionToken<readonly AnyCmsComponentDefinition[]>('CMS_COMPONENTS');

/** `providers: [provideCmsComponents(...CMS_COMPONENT_DEFINITIONS)]`, for an editor that lists the blocks. */
export function provideCmsComponents(...definitions: AnyCmsComponentDefinition[]): EnvironmentProviders {
  return makeEnvironmentProviders(definitions.map((definition) => ({ provide: CMS_COMPONENTS, useValue: definition, multi: true })));
}
