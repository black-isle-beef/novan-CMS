import type { BlockTypeDef, EntryData, FieldDef, FormField } from '@novan/shared-schemas';
import { formFieldsOf, localiseEntryData } from '@novan/shared-schemas';

/** The `form` block type's api id. */
export const FORM_BLOCK = 'form';

/**
 * The visible `form` block with this `_uid` anywhere in a page's data (in any blocks field, nested blocks included), or
 * null. A hidden block, or one inside a hidden block, is not on the site, so it cannot be sent.
 */
export function findFormBlock(value: unknown, uid: string): EntryData | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFormBlock(item, uid);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const node = value as EntryData;
  if (node['_hidden'] === true) return null;
  if (node['_block'] === FORM_BLOCK && node['_uid'] === uid) return node;
  for (const child of Object.values(node)) {
    const found = findFormBlock(child, uid);
    if (found) return found;
  }
  return null;
}

/** A form as a visitor saw it in one locale. */
export interface LocalisedForm {
  /** Its heading, if it has one. */
  name: string | null;
  fields: FormField[];
}

/** The form block in the locale (`chain` is the locale and its fallbacks), with its fields checked. */
export function localiseForm(
  node: EntryData,
  formFields: readonly FieldDef[],
  chain: readonly string[],
  defaultLocale: string,
  blockTypes: readonly BlockTypeDef[],
): LocalisedForm {
  const data = localiseEntryData(formFields, node, chain, defaultLocale, blockTypes);
  const heading = typeof data['heading'] === 'string' && data['heading'].trim() ? data['heading'].trim() : null;
  return { name: heading, fields: formFieldsOf(data['fields']) };
}
