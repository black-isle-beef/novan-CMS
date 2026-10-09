import {
  ANY_LOCALE,
  type BlockNode,
  type BlockType,
  type EntryData,
  type FieldDef,
  isTranslated,
  translationOf,
  withTranslation,
} from '@novan/shared-schemas';
import { type DataPath, getIn, isObject, setIn } from './patches';

/**
 * The page's block lists: its top-level `blocks` fields and, inside them, the `children` of blocks whose type
 * allows children. Blocks fields inside groups are edited in the form view.
 */

/** A list blocks can go in. */
export interface BlockList {
  /** Where the list is in the page data, e.g. `['body']` or `['body', 0, 'children']`. */
  path: DataPath;
  /** Block type api ids allowed in it; empty means none. */
  allowed: readonly string[];
  /** What the list is called, for screen readers: the field's label or "Inside Columns". */
  label: string;
}

/** Where a block is. */
export interface BlockPlace {
  list: BlockList;
  index: number;
  node: BlockNode;
  /** The block whose children the list is, or null at the top level. */
  parent: BlockNode | null;
}

/** One row of the outline: a block and, when its type allows children, the list of them. */
export interface OutlineItem {
  place: BlockPlace;
  depth: number;
  children: OutlineList | null;
}

export interface OutlineList {
  list: BlockList;
  items: OutlineItem[];
}

/** The page's top-level blocks fields as lists. */
export function rootLists(fields: readonly FieldDef[], blockTypes: readonly BlockType[]): BlockList[] {
  return fields.flatMap((field) =>
    field.type === 'blocks' && !field.hidden
      ? [{ path: [field.apiId], allowed: field.allowedBlocks.length ? field.allowedBlocks : blockTypes.map((t) => t.apiId), label: field.label }]
      : [],
  );
}

/** The list inside a block, or null when its type takes no children. */
export function childList(path: DataPath, type: BlockType | undefined): BlockList | null {
  return type?.allowedChildren.length ? { path: [...path, 'children'], allowed: type.allowedChildren, label: `Inside ${type.name}` } : null;
}

export function blocksAt(data: EntryData, list: BlockList): BlockNode[] {
  const value = getIn(data, list.path);
  return Array.isArray(value) ? value.filter(isBlockNode) : [];
}

/** The outline of every block list, depth first. */
export function outline(data: EntryData, roots: readonly BlockList[], blockTypes: readonly BlockType[]): OutlineList[] {
  const typeOf = (apiId: string) => blockTypes.find((type) => type.apiId === apiId);
  const build = (list: BlockList, parent: BlockNode | null, depth: number): OutlineList => ({
    list,
    items: rawBlocks(data, list).map(({ node, index }) => {
      const inner = childList([...list.path, index], typeOf(node._block));
      return { place: { list, index, node, parent }, depth, children: inner ? build(inner, node, depth + 1) : null };
    }),
  });
  return roots.map((list) => build(list, null, 0));
}

/** Where the block with `uid` is, or null. */
export function locate(data: EntryData, roots: readonly BlockList[], blockTypes: readonly BlockType[], uid: string | null): BlockPlace | null {
  if (uid === null) return null;
  const search = (lists: readonly OutlineList[]): BlockPlace | null => {
    for (const { items } of lists) {
      for (const item of items) {
        if (item.place.node._uid === uid) return item.place;
        const found = item.children ? search([item.children]) : null;
        if (found) return found;
      }
    }
    return null;
  };
  return search(outline(data, roots, blockTypes));
}

/** The dotted path of a block in the data, as validation errors name it, e.g. `body.0.children.1`. */
export function dottedPath(place: BlockPlace): string {
  return [...place.list.path, place.index].join('.');
}

export function canHold(list: BlockList, apiId: string): boolean {
  return list.allowed.includes(apiId);
}

/** The data with `node` inserted into `list` at `index`. */
export function insertBlock(data: EntryData, list: BlockList, index: number, node: BlockNode): EntryData {
  const items = listValue(data, list);
  items.splice(clamp(index, 0, items.length), 0, node);
  return setIn(data, list.path, items) as EntryData;
}

/** The data with the block at `place` replaced by `node`. */
export function replaceBlock(data: EntryData, place: BlockPlace, node: BlockNode): EntryData {
  return setIn(data, [...place.list.path, place.index], node) as EntryData;
}

/** The data without the block at `place` (and its children); an emptied `children` list is removed. */
export function removeBlock(data: EntryData, place: BlockPlace): EntryData {
  const items = listValue(data, place.list);
  items.splice(place.index, 1);
  const inChildren = place.list.path[place.list.path.length - 1] === 'children';
  return setIn(data, place.list.path, inChildren && !items.length ? undefined : items) as EntryData;
}

/**
 * The data with the block at `from` moved to `index` in `to` (an index in the list as it is before the move).
 * Refuses (returns null) a list that does not take the block, or a move into the block itself.
 */
export function moveBlock(data: EntryData, from: BlockPlace, to: BlockList, index: number): EntryData | null {
  if (!canHold(to, from.node._block)) return null;
  const own = [...from.list.path, from.index];
  if (startsWith(to.path, own)) return null;
  const sameList = samePath(from.list.path, to.path);
  let target = index;
  if (sameList && from.index < index) target--;
  if (sameList && target === from.index) return data;
  // A later list under the same parent shifts when the block leaves: insert first, then remove.
  const inserted = insertBlock(data, to, sameList ? index : target, from.node);
  const shifted = sameList && index <= from.index ? { ...from, index: from.index + 1 } : adjustAfterInsert(from, to, target);
  return removeBlock(inserted, shifted);
}

/** A copy of the block and everything inside it, with new `_uid`s. */
export function copyBlock(node: BlockNode, newUid: () => string = () => crypto.randomUUID()): BlockNode {
  const copy: BlockNode = { ...structuredClone(node), _uid: newUid() };
  if (Array.isArray(node.children)) copy.children = node.children.map((child) => copyBlock(child, newUid));
  return copy;
}

/**
 * The block's plain text fields with their current values in `locale` (what the bridge may let editors change on the
 * page). In another locale than the default, only translated fields: the others are the same in every language.
 * A field not translated yet holds the default locale's text, as the site shows it, until the editor types over it.
 */
export function textFields(
  node: BlockNode,
  type: BlockType | undefined,
  locale = ANY_LOCALE.defaultLocale,
  defaultLocale = locale,
): { field: string; value: string; multiline: boolean }[] {
  return (type?.fields ?? []).flatMap((field) => {
    if (field.type !== 'text' || field.hidden) return [];
    const translated = isTranslated(field);
    if (!translated && locale !== defaultLocale) return [];
    const stored = node[field.apiId];
    const value = translated ? (translationOf(stored, locale, defaultLocale) ?? translationOf(stored, defaultLocale, defaultLocale)) : stored;
    return typeof value === 'string' ? [{ field: field.apiId, value, multiline: field.multiline }] : [];
  });
}

/** The block with text typed on the page in `locale`: a translated field keeps its other locales. */
export function withText(node: BlockNode, type: BlockType | undefined, field: string, value: string, locale: string, defaultLocale: string): BlockNode {
  const def = type?.fields.find((candidate) => candidate.apiId === field);
  return { ...node, [field]: def && isTranslated(def) ? withTranslation(node[field], locale, value, defaultLocale) : value };
}

export function isBlockNode(value: unknown): value is BlockNode {
  return isObject(value) && typeof value['_uid'] === 'string' && typeof value['_block'] === 'string';
}

// --- Helpers -------------------------------------------------------------------------------------

/** Blocks with their index in the stored list (which may hold other values the outline skips). */
function rawBlocks(data: EntryData, list: BlockList): { node: BlockNode; index: number }[] {
  const value = getIn(data, list.path);
  return Array.isArray(value) ? value.flatMap((node, index) => (isBlockNode(node) ? [{ node, index }] : [])) : [];
}

function listValue(data: EntryData, list: BlockList): unknown[] {
  const value = getIn(data, list.path);
  return Array.isArray(value) ? [...value] : [];
}

/** Where `from` is once a block has been inserted at `index` of `to` (a list before it may hold its path). */
function adjustAfterInsert(from: BlockPlace, to: BlockList, index: number): BlockPlace {
  const path = [...from.list.path];
  const depth = to.path.length;
  // `to` is an ancestor list of `from`: the item at that depth moves down when inserted before it.
  if (depth < path.length && samePath(path.slice(0, depth), to.path) && typeof path[depth] === 'number' && index <= (path[depth] as number)) {
    path[depth] = (path[depth] as number) + 1;
  }
  return { ...from, list: { ...from.list, path } };
}

function startsWith(path: DataPath, prefix: DataPath): boolean {
  return prefix.length <= path.length && prefix.every((key, i) => path[i] === key);
}

function samePath(a: DataPath, b: DataPath): boolean {
  return a.length === b.length && startsWith(a, b);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
