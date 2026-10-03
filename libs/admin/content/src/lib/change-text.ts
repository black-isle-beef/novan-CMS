import type { BlockType, EntryChange, FieldDef } from '@novan/shared-schemas';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One change between two versions as a plain sentence, using field labels and block names. */
export function describeChange(change: EntryChange, fields: readonly FieldDef[], blockTypes: readonly BlockType[]): string {
  const isBlock = change.block !== undefined && uuid.test(change.path[change.path.length - 1] ?? '');
  const blockName = blockTypes.find((type) => type.apiId === change.block)?.name ?? change.block ?? 'block';

  if (isBlock && change.kind !== 'changed') {
    const where = label(change.path.slice(0, -1), fields, blockTypes, change.block);
    switch (change.kind) {
      case 'added':
        return `Added a ${blockName} block to ${where}`;
      case 'removed':
        return `Removed a ${blockName} block from ${where}`;
      case 'moved':
        return `Moved a ${blockName} block in ${where} from position ${(change.from ?? 0) + 1} to ${(change.to ?? 0) + 1}`;
    }
  }

  const what = label(change.path, fields, blockTypes, change.block);
  switch (change.kind) {
    case 'added':
      return `Set ${what}${value(change.after, ' to ')}`;
    case 'removed':
      return `Cleared ${what}${value(change.before, ' (was ', ')')}`;
    default: {
      const before = value(change.before, ' from ');
      const after = value(change.after, ' to ');
      return before && after ? `Changed ${what}${before}${after}` : `Changed ${what}`;
    }
  }
}

/** `Content › Hero block › Heading`. Blocks are named by type where the change says which. */
function label(path: readonly string[], fields: readonly FieldDef[], blockTypes: readonly BlockType[], block?: string): string {
  const lastUid = path.reduce((last, key, i) => (uuid.test(key) ? i : last), -1);
  const labels: string[] = [];
  let available: readonly FieldDef[] | undefined = fields;
  let current: BlockType | undefined;

  path.forEach((key, i) => {
    if (uuid.test(key)) {
      current = i === lastUid ? blockTypes.find((type) => type.apiId === block) : undefined;
      labels.push(current ? `${current.name} block` : 'block');
      available = current?.fields;
      return;
    }
    if (key === 'children') {
      labels.push('Blocks inside');
      available = undefined;
      return;
    }
    const field = available?.find((candidate) => candidate.apiId === key);
    labels.push(field?.label ?? key);
    available = field?.type === 'group' ? field.fields : undefined;
  });
  return labels.join(' › ') || 'the page';
}

/** A short quoted value for plain text, numbers and yes/no; nothing for anything bigger. */
function value(raw: unknown, prefix: string, suffix = ''): string {
  if (typeof raw === 'string') {
    const text = raw.replace(/\s+/g, ' ').trim();
    return `${prefix}“${text.length > 60 ? `${text.slice(0, 59)}…` : text}”${suffix}`;
  }
  if (typeof raw === 'number') return `${prefix}${raw}${suffix}`;
  if (typeof raw === 'boolean') return `${prefix}${raw ? 'yes' : 'no'}${suffix}`;
  return '';
}
