/** A key or index path into entry data, e.g. `['body', 2, 'heading']`. */
export type DataPath = readonly (string | number)[];

/** Sets the value at `path`, or removes it when `value` is undefined. */
export interface Patch {
  path: DataPath;
  value: unknown;
}

/**
 * The smallest set of patches that turns `before` into `after`: changed keys of objects and items of
 * equal-length lists are followed down; anything else is replaced whole. Both values are left as they are.
 */
export function diff(before: unknown, after: unknown, path: DataPath = []): Patch[] {
  if (Object.is(before, after)) return [];
  if (isObject(before) && isObject(after)) {
    const patches: Patch[] = [];
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!(key in after)) patches.push({ path: [...path, key], value: undefined });
      else if (!(key in before)) patches.push({ path: [...path, key], value: after[key] });
      else patches.push(...diff(before[key], after[key], [...path, key]));
    }
    return patches;
  }
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    return before.flatMap((item, index) => diff(item, after[index], [...path, index]));
  }
  return [{ path, value: after }];
}

/** A copy of `value` with the patches applied in order; only the objects and lists on their paths are copied. */
export function applyPatches<T>(value: T, patches: readonly Patch[]): T {
  return patches.reduce<unknown>((current, patch) => setIn(current, patch.path, patch.value), value) as T;
}

/** The value at `path`, or undefined. */
export function getIn(value: unknown, path: DataPath): unknown {
  let current = value;
  for (const key of path) {
    if (Array.isArray(current) && typeof key === 'number') current = current[key];
    else if (isObject(current) && typeof key === 'string') current = current[key];
    else return undefined;
  }
  return current;
}

/** A copy of `value` with `next` at `path` (removed when undefined), creating objects on the way. */
export function setIn(value: unknown, path: DataPath, next: unknown): unknown {
  if (!path.length) return next;
  const [key, ...rest] = path;
  if (Array.isArray(value) && typeof key === 'number') {
    const copy = [...value];
    if (rest.length === 0 && next === undefined) copy.splice(key, 1);
    else copy[key] = setIn(copy[key], rest, next);
    return copy;
  }
  const copy: Record<string, unknown> = isObject(value) ? { ...value } : {};
  if (rest.length === 0 && next === undefined) delete copy[String(key)];
  else copy[String(key)] = setIn(copy[String(key)], rest, next);
  return copy;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
