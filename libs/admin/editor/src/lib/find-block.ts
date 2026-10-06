import type { BlockNode } from '@novan/shared-schemas';

/** The block with this `_uid` anywhere in the page's data (blocks fields, children, groups), or null. */
export function findBlock(data: unknown, uid: string | null): BlockNode | null {
  if (uid === null) return null;
  const stack: unknown[] = [data];
  while (stack.length) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      stack.push(...value);
    } else if (typeof value === 'object' && value !== null) {
      const node = value as Record<string, unknown>;
      if (node['_uid'] === uid && typeof node['_block'] === 'string') return node as BlockNode;
      stack.push(...Object.values(node));
    }
  }
  return null;
}
