import type { FieldDef, UpdateBlockTypeRequest, UpdateContentTypeRequest } from '@novan/shared-schemas';
import { type Change, describe, formatChanges, type TypeKind } from './diff';
import { ApiError, SchemaSyncError } from './errors';
import type { BlockTypeFile, ContentTypeFile, SchemaSet } from './schema-files';

/**
 * The Management API calls a push makes, against `target` (whatever the caller uses to name a space and
 * environment). Failures must be thrown as {@link ApiError}, so `entries_invalidated` and `*_in_use` are recognised.
 */
export interface SchemaWriter<T> {
  createContentType(target: T, body: ContentTypeFile): Promise<unknown>;
  updateContentType(target: T, apiId: string, body: UpdateContentTypeRequest, force: boolean): Promise<unknown>;
  deleteContentType(target: T, apiId: string, force: boolean): Promise<unknown>;
  createBlockType(target: T, body: BlockTypeFile): Promise<unknown>;
  updateBlockType(target: T, apiId: string, body: UpdateBlockTypeRequest, force: boolean): Promise<unknown>;
  deleteBlockType(target: T, apiId: string, force: boolean): Promise<unknown>;
}

export interface PushOptions {
  force: boolean;
  dryRun: boolean;
  log: (line: string) => void;
  /** How to ask for `force`, in refusals: "Run again with --force" by default. */
  forceHint?: string;
}

/** Block and content types a type's definition points at; they must exist before it can be saved with them. */
export function referencesOf(kind: TypeKind, type: ContentTypeFile | BlockTypeFile): { kind: TypeKind; apiId: string }[] {
  const walk = (fields: readonly FieldDef[]): { kind: TypeKind; apiId: string }[] =>
    fields.flatMap((field) => {
      if (field.type === 'blocks') return field.allowedBlocks.map((apiId) => ({ kind: 'blockType' as const, apiId }));
      if (field.type === 'reference') return field.contentTypes.map((apiId) => ({ kind: 'contentType' as const, apiId }));
      if (field.type === 'group') return walk(field.fields);
      return [];
    });
  const children = kind === 'blockType' ? (type as BlockTypeFile).allowedChildren.map((apiId) => ({ kind: 'blockType' as const, apiId })) : [];
  return [...walk(type.fields), ...children];
}

/**
 * Applies `changes` (from {@link diffSchemas}) to the space, through the Management API. Destructive changes are
 * refused up front without `force`. Types are created in an order where everything they point at already exists;
 * types that point at each other are created empty, then filled in. Deletions come last, content types first.
 * The API still refuses a change that would make existing entries invalid (409 `entries_invalidated`) unless forced.
 */
export async function applyChanges<T>(api: SchemaWriter<T>, target: T, local: SchemaSet, remote: SchemaSet, changes: readonly Change[], options: PushOptions): Promise<void> {
  const forceHint = options.forceHint ?? 'Run again with --force';
  const destructive = changes.filter((change) => change.destructive);
  if (destructive.length && !options.force) {
    throw new SchemaSyncError(
      ['These changes can lose content or make it invalid:', ...formatChanges(destructive), `Nothing was changed. ${forceHint} to apply them.`].join('\n'),
    );
  }
  if (options.dryRun) {
    options.log(changes.length ? 'Dry run: nothing was changed.' : 'The space already matches.');
    return;
  }

  const localType = (kind: TypeKind, apiId: string): ContentTypeFile | BlockTypeFile => {
    const found = kind === 'contentType' ? local.contentTypes.find((t) => t.apiId === apiId) : local.blockTypes.find((t) => t.apiId === apiId);
    if (!found) throw new Error(`No local ${kind} ${apiId}`);
    return found;
  };
  const key = (kind: TypeKind, apiId: string) => `${kind}:${apiId}`;
  const existing = new Set([
    ...remote.contentTypes.map((t) => key('contentType', t.apiId)),
    ...remote.blockTypes.map((t) => key('blockType', t.apiId)),
  ]);
  const guard = async (change: Pick<Change, 'kind' | 'apiId'>, work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'entries_invalidated') {
        throw new SchemaSyncError(`${describe(change)}: ${error.detail} ${forceHint} to apply it anyway; those entries then need fixing.`);
      }
      if (error instanceof ApiError) throw new SchemaSyncError(`${describe(change)}: ${error.message}`);
      throw error;
    }
  };

  // 1. Create, in dependency order. Whatever is left points in a circle: create it empty and fill it in below.
  let pending = changes.filter((change) => change.action === 'create');
  const fillLater: Change[] = [];
  while (pending.length) {
    const ready = pending.filter((change) => referencesOf(change.kind, localType(change.kind, change.apiId)).every((ref) => existing.has(key(ref.kind, ref.apiId)) || (ref.kind === change.kind && ref.apiId === change.apiId)));
    const batch = ready.length ? ready : [pending[0]];
    for (const change of batch) {
      const type = localType(change.kind, change.apiId);
      const empty = !ready.length;
      await guard(change, () =>
        change.kind === 'contentType'
          ? api.createContentType(target, empty ? { ...(type as ContentTypeFile), fields: [] } : (type as ContentTypeFile))
          : api.createBlockType(target, empty ? { ...(type as BlockTypeFile), fields: [], allowedChildren: [] } : (type as BlockTypeFile)),
      );
      if (empty) fillLater.push(change);
      existing.add(key(change.kind, change.apiId));
      options.log(`Created ${describe(change)}${empty ? ' (filled in next)' : ''}.`);
    }
    pending = pending.filter((change) => !batch.includes(change));
  }

  // 2. Update: block types first, so content types can allow blocks that just changed.
  const updates = [...changes.filter((change) => change.action === 'update'), ...fillLater].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'blockType' ? -1 : 1));
  for (const change of updates) {
    const type = localType(change.kind, change.apiId);
    await guard(change, () => {
      if (change.kind === 'contentType') {
        const { name, description, fields } = type as ContentTypeFile;
        return api.updateContentType(target, change.apiId, { name, description, fields }, options.force);
      }
      const { name, icon, previewImagePath, fields, allowedChildren, styleOptions } = type as BlockTypeFile;
      return api.updateBlockType(target, change.apiId, { name, icon, previewImagePath, fields, allowedChildren, styleOptions }, options.force);
    });
    options.log(`Updated ${describe(change)}.`);
  }

  // 3. Delete: content types first (they allow blocks), and again while each round frees another type in use.
  let deletions = changes.filter((change) => change.action === 'delete').sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'contentType' ? -1 : 1));
  while (deletions.length) {
    const blocked: Change[] = [];
    let lastError: ApiError | null = null;
    for (const change of deletions) {
      try {
        await (change.kind === 'contentType' ? api.deleteContentType(target, change.apiId, options.force) : api.deleteBlockType(target, change.apiId, options.force));
        options.log(`Deleted ${describe(change)}.`);
      } catch (error) {
        if (!(error instanceof ApiError) || !error.code.endsWith('_in_use')) throw error;
        blocked.push(change);
        lastError = error;
      }
    }
    if (blocked.length === deletions.length) throw new SchemaSyncError(`${describe(blocked[0])}: ${lastError?.detail ?? 'still in use.'}`);
    deletions = blocked;
  }
}
