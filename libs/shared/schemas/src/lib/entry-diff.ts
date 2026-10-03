import type { BlockNode } from './fields';

// Differences between two versions of an entry's data (docs/build/06-entries-versions.md). Blocks are
// matched by their `_uid`, so a block that moved is reported as moved, not as one removed and one added,
// and changes inside it are reported against the same block in both versions.

export type EntryChangeKind = 'added' | 'removed' | 'changed' | 'moved';

export interface EntryChange {
  kind: EntryChangeKind;
  /** Keys from the root of the data. Inside a blocks field, a block is identified by its `_uid`. */
  path: string[];
  /** The block type (`_block`) when the change is a block, or is inside one. */
  block?: string;
  before?: unknown;
  after?: unknown;
  /** For a moved block: its position among the blocks both versions share, before and after. */
  from?: number;
  to?: number;
}

/** `GET .../versions/:a/diff/:b`: what changed going from version `from` to version `to`. */
export interface EntryDiff {
  from: string;
  to: string;
  changes: EntryChange[];
}

/** Changes that turn `before` into `after`. Equal JSON (whatever the key order) has no changes. */
export function diffEntryData(before: Record<string, unknown>, after: Record<string, unknown>): EntryChange[] {
  const changes: EntryChange[] = [];
  diffObjects(before, after, [], undefined, changes);
  return changes;
}

function diffValue(before: unknown, after: unknown, path: string[], block: string | undefined, out: EntryChange[]): void {
  if (sameJson(before, after)) return;

  const blocksBefore = asBlocks(before, after);
  const blocksAfter = asBlocks(after, before);
  if (blocksBefore && blocksAfter) {
    diffBlocks(blocksBefore, blocksAfter, path, out);
    return;
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    diffObjects(before, after, path, block, out);
    return;
  }
  if (before === undefined || before === null) out.push(change('added', path, block, { after }));
  else if (after === undefined || after === null) out.push(change('removed', path, block, { before }));
  else out.push(change('changed', path, block, { before, after }));
}

function diffObjects(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  path: string[],
  block: string | undefined,
  out: EntryChange[],
): void {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  for (const key of keys) diffValue(before[key], after[key], [...path, key], block, out);
}

function diffBlocks(before: BlockNode[], after: BlockNode[], path: string[], out: EntryChange[]): void {
  const afterByUid = new Map(after.map((node) => [node._uid, node]));
  const beforeByUid = new Map(before.map((node) => [node._uid, node]));

  for (const node of before) {
    if (!afterByUid.has(node._uid)) out.push(change('removed', [...path, node._uid], node._block, { before: node }));
  }
  for (const node of after) {
    if (!beforeByUid.has(node._uid)) out.push(change('added', [...path, node._uid], node._block, { after: node }));
  }

  // Positions among the blocks both versions keep, so adding or removing others is not a move.
  const keptBefore = before.filter((node) => afterByUid.has(node._uid)).map((node) => node._uid);
  const keptAfter = after.filter((node) => beforeByUid.has(node._uid)).map((node) => node._uid);
  keptAfter.forEach((uid, to) => {
    const from = keptBefore.indexOf(uid);
    const node = afterByUid.get(uid) as BlockNode;
    if (from !== to) out.push({ kind: 'moved', path: [...path, uid], block: node._block, from, to });

    const old = beforeByUid.get(uid) as BlockNode;
    if (old._block !== node._block) {
      out.push(change('changed', [...path, uid], node._block, { before: old, after: node }));
      return;
    }
    diffObjects(fieldsOf(old), fieldsOf(node), [...path, uid], node._block, out);
  });
}

/** A block's field values (and `children`), without its identity. */
function fieldsOf(node: BlockNode): Record<string, unknown> {
  return Object.fromEntries(Object.entries(node).filter(([key]) => key !== '_uid' && key !== '_block'));
}

function change(
  kind: EntryChangeKind,
  path: string[],
  block: string | undefined,
  values: { before?: unknown; after?: unknown },
): EntryChange {
  return { kind, path, ...(block ? { block } : {}), ...values };
}

/** `value` as a block list. A missing value or empty list counts as one when `other` is a block list. */
function asBlocks(value: unknown, other: unknown): BlockNode[] | null {
  if (isBlockList(value)) return value;
  const empty = value === undefined || value === null || (Array.isArray(value) && value.length === 0);
  return empty && isBlockList(other) ? [] : null;
}

function isBlockList(value: unknown): value is BlockNode[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => isPlainObject(item) && typeof item['_uid'] === 'string' && typeof item['_block'] === 'string')
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep equality for JSON values, ignoring object key order (Postgres `jsonb` reorders keys). */
export function sameJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameJson(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a).filter((key) => a[key] !== undefined);
    const keysB = Object.keys(b).filter((key) => b[key] !== undefined);
    return keysA.length === keysB.length && keysA.every((key) => sameJson(a[key], b[key]));
  }
  return a === b;
}
