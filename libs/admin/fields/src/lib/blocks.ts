import { ANY_LOCALE, type BlockNode, type BlockType, type FieldDefOf, isEmptyValue, isTranslated, translationOf } from '@novan/shared-schemas';

/** A new block of `type` with a fresh `_uid` and its fields' defaults. */
export function newBlock(type: BlockType): BlockNode {
  const defaults = Object.fromEntries(
    type.fields.flatMap((field) => (field.type === 'boolean' && field.default !== undefined ? [[field.apiId, field.default]] : [])),
  );
  return { _uid: crypto.randomUUID(), _block: type.apiId, ...defaults };
}

/**
 * The first filled-in text field of a block, shortened, so a collapsed block can be told apart. A translated text is
 * read in `locale`, else in the default locale.
 */
export function blockSummary(node: BlockNode, type: BlockType | undefined, locale = ANY_LOCALE.defaultLocale, defaultLocale = locale): string {
  for (const field of type?.fields ?? []) {
    const stored = node[field.apiId];
    const value = isTranslated(field)
      ? [translationOf(stored, locale, defaultLocale), translationOf(stored, defaultLocale, defaultLocale)].find((text) => !isEmptyValue(text))
      : stored;
    if (field.type === 'text' && typeof value === 'string' && value.trim()) {
      const text = value.trim().replace(/\s+/g, ' ');
      return text.length > 60 ? `${text.slice(0, 59)}…` : text;
    }
  }
  return '';
}

/** The field definition for a block's nested `children`. */
export function childrenField(type: BlockType): FieldDefOf<'blocks'> {
  return {
    id: 'children',
    apiId: 'children',
    label: `Blocks inside ${type.name}`,
    type: 'blocks',
    required: false,
    localised: false,
    allowedBlocks: type.allowedChildren,
  };
}

export function isBlockNode(value: unknown): value is BlockNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as BlockNode)._uid === 'string' &&
    typeof (value as BlockNode)._block === 'string'
  );
}
