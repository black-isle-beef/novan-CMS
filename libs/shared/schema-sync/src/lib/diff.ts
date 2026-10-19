import type { FieldDef } from '@novan/shared-schemas';
import type { BlockTypeFile, ContentTypeFile, SchemaSet } from './schema-files';

export type TypeKind = 'contentType' | 'blockType';

/** One difference between the schema files and the space, as `schema push` would apply it. */
export interface Change {
  action: 'create' | 'update' | 'delete';
  kind: TypeKind;
  apiId: string;
  /** What differs, for updates: `fields.title: max 120 → 80`, `fields.summary added`. */
  details: string[];
  /** Deletes a type, removes a field or changes a field's type: content in the space may be lost or invalid. */
  destructive: boolean;
}

const KIND_LABEL: Record<TypeKind, string> = { contentType: 'content type', blockType: 'block type' };

/** JSON with object keys sorted, so key order in a file never counts as a change. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
}

const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

/**
 * What it takes to make `remote` (the space) match `local` (the files). Content types are listed before block types
 * within each action; `schema push` orders the actual calls itself.
 */
export function diffSchemas(local: SchemaSet, remote: SchemaSet): Change[] {
  return [
    ...diffKind('contentType', local.contentTypes, remote.contentTypes, contentTypeDetails),
    ...diffKind('blockType', local.blockTypes, remote.blockTypes, blockTypeDetails),
  ];
}

function diffKind<T extends { apiId: string }>(
  kind: TypeKind,
  local: readonly T[],
  remote: readonly T[],
  details: (local: T, remote: T) => { details: string[]; destructive: boolean },
): Change[] {
  const remoteById = new Map(remote.map((type) => [type.apiId, type]));
  const localIds = new Set(local.map((type) => type.apiId));
  const changes: Change[] = [];
  for (const type of local) {
    const current = remoteById.get(type.apiId);
    if (!current) {
      changes.push({ action: 'create', kind, apiId: type.apiId, details: [], destructive: false });
    } else if (!same(type, current)) {
      changes.push({ action: 'update', kind, apiId: type.apiId, ...details(type, current) });
    }
  }
  for (const type of remote) {
    if (!localIds.has(type.apiId)) changes.push({ action: 'delete', kind, apiId: type.apiId, details: [], destructive: true });
  }
  return changes;
}

function contentTypeDetails(local: ContentTypeFile, remote: ContentTypeFile): { details: string[]; destructive: boolean } {
  const details: string[] = [];
  if (local.name !== remote.name) details.push(`name: "${remote.name}" → "${local.name}"`);
  if (local.description !== remote.description) details.push('description changed');
  const fields = fieldDetails(local.fields, remote.fields, 'fields');
  return { details: [...details, ...fields.details], destructive: fields.destructive };
}

function blockTypeDetails(local: BlockTypeFile, remote: BlockTypeFile): { details: string[]; destructive: boolean } {
  const details: string[] = [];
  if (local.name !== remote.name) details.push(`name: "${remote.name}" → "${local.name}"`);
  if (local.icon !== remote.icon) details.push(`icon: ${remote.icon ?? 'none'} → ${local.icon ?? 'none'}`);
  if (local.previewImagePath !== remote.previewImagePath) details.push('preview image changed');
  if (!same(local.allowedChildren, remote.allowedChildren)) details.push(`allowed children: [${remote.allowedChildren.join(', ')}] → [${local.allowedChildren.join(', ')}]`);
  for (const key of new Set([...Object.keys(remote.styleOptions), ...Object.keys(local.styleOptions)])) {
    const before = remote.styleOptions[key];
    const after = local.styleOptions[key];
    if (!before) details.push(`style option ${key} added`);
    else if (!after) details.push(`style option ${key} removed`);
    else if (!same(before, after)) details.push(`style option ${key} changed`);
  }
  // Stored style values that are no longer offered fall back to the default (resolveSettings), so style changes
  // never lose content; only field changes can.
  const fields = fieldDetails(local.fields, remote.fields, 'fields');
  return { details: [...details, ...fields.details], destructive: fields.destructive };
}

function fieldDetails(local: readonly FieldDef[], remote: readonly FieldDef[], path: string): { details: string[]; destructive: boolean } {
  const details: string[] = [];
  let destructive = false;
  const remoteById = new Map(remote.map((field) => [field.apiId, field]));
  const localIds = new Set(local.map((field) => field.apiId));
  for (const field of local) {
    const at = `${path}.${field.apiId}`;
    const current = remoteById.get(field.apiId);
    if (!current) {
      details.push(`${at} added${field.required ? ' (required)' : ''}`);
    } else if (current.type !== field.type) {
      details.push(`${at}: type ${current.type} → ${field.type}`);
      destructive = true;
    } else if (field.type === 'group' && current.type === 'group') {
      if (!same({ ...field, fields: [] }, { ...current, fields: [] })) details.push(`${at} changed`);
      const nested = fieldDetails(field.fields, current.fields, `${at}`);
      details.push(...nested.details);
      destructive ||= nested.destructive;
    } else if (!same(field, current)) {
      details.push(`${at} changed`);
    }
  }
  for (const field of remote) {
    if (!localIds.has(field.apiId)) {
      details.push(`${path}.${field.apiId} removed`);
      destructive = true;
    }
  }
  if (!details.length && !same(local.map((field) => field.apiId), remote.map((field) => field.apiId))) details.push(`${path} reordered`);
  return { details, destructive };
}

/** `+ content type post`, `~ block type hero` with its details indented, `- block type old (destructive)`. */
export function formatChanges(changes: readonly Change[]): string[] {
  const sign = { create: '+', update: '~', delete: '-' } as const;
  return changes.flatMap((change) => [
    `${sign[change.action]} ${KIND_LABEL[change.kind]} ${change.apiId}${change.destructive ? '  (destructive)' : ''}`,
    ...change.details.map((detail) => `    ${detail}`),
  ]);
}

export function describe(change: Pick<Change, 'kind' | 'apiId'>): string {
  return `${KIND_LABEL[change.kind]} ${change.apiId}`;
}
