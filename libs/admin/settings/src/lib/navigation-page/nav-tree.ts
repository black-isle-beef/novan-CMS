import { type EntryData, type FieldDef, type FieldDefOf, isEmptyValue, isLocaleMap } from '@novan/shared-schemas';

/** One item of a menu: its fields, e.g. `{ label, link, subItems }`. */
export type NavNode = Record<string, unknown>;

/**
 * A menu of the `navigation` singleton as a two-level tree: a repeatable group (the main menu's `items`, the footer's
 * `footerGroups`) whose items hold a repeatable group of their own (`subItems`, `links`).
 */
export interface NavTree {
  /** The top-level group, e.g. `items`. */
  field: FieldDefOf<'group'>;
  /** The group inside each item, e.g. `subItems`. */
  children: FieldDefOf<'group'> | null;
  /** The field that names an item, e.g. `label` or `title`. */
  nameKey: string;
  /** The child field that names a child, e.g. `label`. */
  childNameKey: string;
  /**
   * Whether an item can become a child of the one above it and back: the child's fields are a subset of the item's
   * (a main menu item and a sub-link both have a label and a link; a footer column and a link do not).
   */
  nests: boolean;
}

/** The trees of a `navigation` type: each repeatable group field whose items hold a repeatable group. */
export function navTrees(fields: readonly FieldDef[]): NavTree[] {
  return fields.flatMap((field): NavTree[] => {
    if (field.type !== 'group' || !field.multiple) return [];
    const children = field.fields.find((child): child is FieldDefOf<'group'> => child.type === 'group' && child.multiple) ?? null;
    const own = field.fields.filter((f) => f !== children).map((f) => f.apiId);
    const childKeys = children?.fields.map((f) => f.apiId) ?? [];
    return [
      {
        field,
        children,
        nameKey: nameOf(field.fields),
        childNameKey: children ? nameOf(children.fields) : 'label',
        nests: !!children && childKeys.every((key) => own.includes(key)),
      },
    ];
  });
}

/** The items of a list, at `['items']` or `['items', 2, 'subItems']`. */
export function listAt(data: EntryData, path: readonly (string | number)[]): NavNode[] {
  let value: unknown = data;
  for (const key of path) value = isNode(value) || Array.isArray(value) ? (value as Record<string | number, unknown>)[key] : undefined;
  return Array.isArray(value) ? value.filter(isNode) : [];
}

/** `data` with the list at `path` replaced. */
export function withList(data: EntryData, path: readonly (string | number)[], list: NavNode[]): EntryData {
  if (path.length === 1) return { ...data, [path[0]]: list };
  const [key, index, ...rest] = path as [string, number, ...(string | number)[]];
  const items = listAt(data, [key]).map((item, i) => (i === index ? withList(item, rest, list) : item));
  return { ...data, [key]: items };
}

export function addItem(data: EntryData, path: readonly (string | number)[]): EntryData {
  return withList(data, path, [...listAt(data, path), {}]);
}

export function removeItem(data: EntryData, path: readonly (string | number)[], index: number): EntryData {
  return withList(data, path, listAt(data, path).filter((_, i) => i !== index));
}

export function moveItem(data: EntryData, path: readonly (string | number)[], index: number, offset: -1 | 1): EntryData {
  const list = [...listAt(data, path)];
  const target = index + offset;
  if (target < 0 || target >= list.length) return data;
  [list[index], list[target]] = [list[target], list[index]];
  return withList(data, path, list);
}

/** Makes item `index` the last child of the item above it. Only for an item without children of its own. */
export function nestItem(data: EntryData, tree: NavTree, index: number): EntryData {
  const key = tree.field.apiId;
  const childKey = tree.children?.apiId;
  const items = listAt(data, [key]);
  const node = items[index];
  if (!tree.nests || !childKey || index === 0 || !node || listAt(node, [childKey]).length) return data;
  const keep = new Set(tree.children?.fields.map((f) => f.apiId));
  const child = Object.fromEntries(Object.entries(node).filter(([field]) => keep.has(field)));
  const above = items[index - 1];
  const next = items
    .map((item, i) => (i === index - 1 ? { ...above, [childKey]: [...listAt(above, [childKey]), child] } : item))
    .filter((_, i) => i !== index);
  return { ...data, [key]: next };
}

/** Makes child `childIndex` of item `index` an item of its own, just after its parent. */
export function unnestItem(data: EntryData, tree: NavTree, index: number, childIndex: number): EntryData {
  const key = tree.field.apiId;
  const childKey = tree.children?.apiId;
  const items = listAt(data, [key]);
  const parent = items[index];
  const child = parent && childKey ? listAt(parent, [childKey])[childIndex] : undefined;
  if (!tree.nests || !childKey || !parent || !child) return data;
  const next = [...items];
  next[index] = { ...parent, [childKey]: listAt(parent, [childKey]).filter((_, i) => i !== childIndex) };
  next.splice(index + 1, 0, { ...child });
  return { ...data, [key]: next };
}

/** What to call an item in buttons and announcements: its name, or its position. */
export function itemName(node: NavNode | undefined, key: string, position: number, locale?: string): string {
  const stored = node?.[key];
  // A translated name: in the locale shown, else the first translation there is.
  const name = isLocaleMap(stored) ? [...(locale ? [stored[locale]] : []), ...Object.values(stored)].find((value) => !isEmptyValue(value)) : stored;
  return typeof name === 'string' && name.trim() ? `“${name.trim()}”` : `item ${position}`;
}

function nameOf(fields: readonly FieldDef[]): string {
  return fields.find((f) => f.type === 'text')?.apiId ?? 'label';
}

function isNode(value: unknown): value is NavNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
