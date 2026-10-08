import type { BlockNode, BlockTypeDef, EntryData, FieldDef } from '@novan/shared-schemas';

/** A value to drop: a missing single value becomes `null`, a missing item of a list is left out. */
export const DROP = Symbol('drop');
type Mapped = unknown | typeof DROP;

/** What to do with the values that point elsewhere. Each returns the value to deliver, or {@link DROP}. */
export interface EntryVisitor {
  /** A media item, `{ assetId, alt? }`. */
  media?(item: { assetId: string; alt?: string }): Mapped;
  /** A reference field's entry id. */
  reference?(entryId: string): Mapped;
  /** A link field's value, `{ type: 'internal', entryId, ... }` or an external or email link. */
  link?(link: Record<string, unknown>): Mapped;
  /** A block, before its fields and children are mapped; {@link DROP} leaves it (and its children) out. */
  block?(node: BlockNode): BlockNode | typeof DROP;
}

/**
 * A copy of entry data with media items, references and links replaced by the visitor, following the field
 * definitions through groups and blocks (block fields need `blockTypes`). Values of an unexpected shape
 * are kept as they are, so published data written before a model change still comes through.
 */
export function mapEntryData(
  fields: readonly FieldDef[],
  data: EntryData,
  blockTypes: ReadonlyMap<string, BlockTypeDef>,
  visitor: EntryVisitor,
): EntryData {
  const mapFields = (defs: readonly FieldDef[], values: unknown): unknown => {
    if (!isObject(values)) return values;
    const out: EntryData = { ...values };
    for (const field of defs) {
      if (field.apiId in out) out[field.apiId] = mapField(field, out[field.apiId]);
    }
    return out;
  };

  const mapNodes = (nodes: unknown): unknown => {
    if (!Array.isArray(nodes)) return nodes;
    return nodes.flatMap((value) => {
      if (!isObject(value) || typeof value['_block'] !== 'string') return [value];
      const node = visitor.block ? visitor.block(value as BlockNode) : (value as BlockNode);
      if (node === DROP) return [];
      const type = blockTypes.get(node._block);
      const mapped = (type ? mapFields(type.fields, node) : { ...node }) as BlockNode;
      if (Array.isArray(node.children)) mapped.children = mapNodes(node.children) as BlockNode[];
      return [mapped];
    });
  };

  const many = (value: unknown, multiple: boolean, map: (item: unknown) => Mapped): unknown => {
    if (value === null || value === undefined) return value;
    if (multiple) {
      if (!Array.isArray(value)) return value;
      return value.map(map).filter((item) => item !== DROP);
    }
    const mapped = map(value);
    return mapped === DROP ? null : mapped;
  };

  const mapField = (field: FieldDef, value: unknown): unknown => {
    switch (field.type) {
      case 'media':
        if (!visitor.media) return value;
        return many(value, field.multiple, (item) =>
          isObject(item) && typeof item['assetId'] === 'string' ? visitor.media?.(item as { assetId: string; alt?: string }) : item,
        );
      case 'reference':
        if (!visitor.reference) return value;
        return many(value, field.multiple, (item) => (typeof item === 'string' ? visitor.reference?.(item) : item));
      case 'link':
        if (!visitor.link || !isObject(value)) return value;
        return many(value, false, (item) => visitor.link?.(item as Record<string, unknown>));
      case 'group':
        return field.multiple && Array.isArray(value) ? value.map((item) => mapFields(field.fields, item)) : mapFields(field.fields, value);
      case 'blocks':
        return mapNodes(value);
      default:
        return value;
    }
  };

  return mapFields(fields, data) as EntryData;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
