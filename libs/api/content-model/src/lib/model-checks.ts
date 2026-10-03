import { type BlockTypeDef, buildEntrySchema, type FieldDef } from '@novan/shared-schemas';
import type { StoredEntry } from './entry-source';

/** The content model of one environment, as far as entry validation is concerned. */
export interface ModelSnapshot {
  contentTypes: readonly { id: string; fields: readonly FieldDef[] }[];
  blockTypes: readonly BlockTypeDef[];
}

/** Api ids of the other types a field list points at, with the path of each mention. */
export interface ModelReference {
  kind: 'blockType' | 'contentType';
  apiId: string;
  path: string;
}

/** Every block type and content type mentioned by `blocks` and `reference` fields, including inside groups. */
export function referencesIn(fields: readonly FieldDef[], path = 'fields'): ModelReference[] {
  return fields.flatMap((field, index): ModelReference[] => {
    const at = `${path}.${index}`;
    switch (field.type) {
      case 'blocks':
        return field.allowedBlocks.map((apiId, i) => ({ kind: 'blockType', apiId, path: `${at}.allowedBlocks.${i}` }));
      case 'reference':
        return field.contentTypes.map((apiId, i) => ({ kind: 'contentType', apiId, path: `${at}.contentTypes.${i}` }));
      case 'group':
        return referencesIn(field.fields, `${at}.fields`);
      default:
        return [];
    }
  });
}

/** Validation-style errors (dotted path to messages) for references to types that do not exist. */
export function unknownReferences(
  references: readonly ModelReference[],
  known: { blockTypes: ReadonlySet<string>; contentTypes: ReadonlySet<string> },
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const reference of references) {
    const exists =
      reference.kind === 'blockType' ? known.blockTypes.has(reference.apiId) : known.contentTypes.has(reference.apiId);
    if (!exists) {
      const what = reference.kind === 'blockType' ? 'block type' : 'content type';
      (errors[reference.path] ??= []).push(`There is no ${what} "${reference.apiId}" in this environment.`);
    }
  }
  return errors;
}

/**
 * Entries that are valid under the current model but would fail validation after the change.
 * Entries that were already invalid are not blamed on this change.
 */
export function affectedEntries(entries: readonly StoredEntry[], before: ModelSnapshot, after: ModelSnapshot): number {
  if (entries.length === 0) return 0;
  const valid = validator(before);
  const stillValid = validator(after);
  return entries.filter((entry) => valid(entry) && !stillValid(entry)).length;
}

function validator(model: ModelSnapshot): (entry: StoredEntry) => boolean {
  const schemas = new Map(
    model.contentTypes.map((type) => [type.id, buildEntrySchema(type.fields, { blockTypes: model.blockTypes })]),
  );
  return (entry) => schemas.get(entry.contentTypeId)?.safeParse(entry.data).success ?? false;
}
