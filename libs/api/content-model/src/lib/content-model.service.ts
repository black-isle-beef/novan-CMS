import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { conflict, forbidden, notFound, ProblemException } from '@novan/api-common';
import type { AuthUser } from '@novan/api-auth';
import {
  blockTypes,
  contentTypes,
  DbService,
  type DbTransaction,
  environments,
  isInsufficientPrivilege,
  isUniqueViolation,
  recordAudit,
} from '@novan/api-db';
import type {
  BlockType,
  ContentType,
  ContentTypeKind,
  createBlockTypeRequestSchema,
  createContentTypeRequestSchema,
  FieldDef,
  StyleOptions,
  updateBlockTypeRequestSchema,
  updateContentTypeRequestSchema,
} from '@novan/shared-schemas';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { ENTRY_SOURCE, type EntrySource } from './entry-source';
import { affectedEntries, type ModelReference, type ModelSnapshot, referencesIn, unknownReferences } from './model-checks';

type CreateContentTypeBody = z.output<typeof createContentTypeRequestSchema>;
type UpdateContentTypeBody = z.output<typeof updateContentTypeRequestSchema>;
type CreateBlockTypeBody = z.output<typeof createBlockTypeRequestSchema>;
type UpdateBlockTypeBody = z.output<typeof updateBlockTypeRequestSchema>;

/** One environment's content model, loaded once per request. */
interface Model {
  environmentId: string;
  contentTypes: ContentType[];
  blockTypes: BlockType[];
}

/**
 * Content types and block types of an environment. Every query runs as the caller under RLS
 * (`DbService.userDb`), every write is audited in the same transaction, and a change that would make
 * existing entries invalid is refused unless forced.
 */
@Injectable()
export class ContentModelService {
  constructor(
    private readonly db: DbService,
    @Inject(ENTRY_SOURCE) private readonly entries: EntrySource,
  ) {}

  // --- Content types -----------------------------------------------------------------------------

  listContentTypes(user: AuthUser, spaceId: string, env: string): Promise<ContentType[]> {
    return this.db.userDb(user.claims, async (tx) => {
      const environmentId = await this.environmentId(tx, spaceId, env);
      const rows = await tx
        .select()
        .from(contentTypes)
        .where(and(eq(contentTypes.spaceId, spaceId), eq(contentTypes.environmentId, environmentId)))
        .orderBy(asc(contentTypes.name));
      return rows.map(toContentType);
    });
  }

  getContentType(user: AuthUser, spaceId: string, env: string, apiId: string): Promise<ContentType> {
    return this.db.userDb(user.claims, async (tx) => {
      const model = await this.model(tx, spaceId, env);
      return findContentType(model, apiId);
    });
  }

  async createContentType(user: AuthUser, spaceId: string, env: string, body: CreateContentTypeBody): Promise<ContentType> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const model = await this.model(tx, spaceId, env);
        assertReferencesExist(referencesIn(body.fields), model, { contentType: body.apiId });

        const [row] = await tx
          .insert(contentTypes)
          .values({
            spaceId,
            environmentId: model.environmentId,
            apiId: body.apiId,
            name: body.name,
            kind: body.kind,
            description: body.description ?? null,
            fields: body.fields,
          })
          .returning();
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'content_type.created',
          targetType: 'content_type',
          targetId: row.id,
          diff: { environment: env, apiId: row.apiId, kind: row.kind },
        });
        return toContentType(row);
      });
    } catch (error) {
      throw dbProblem(error, 'content type', body.apiId);
    }
  }

  async updateContentType(
    user: AuthUser,
    spaceId: string,
    env: string,
    apiId: string,
    body: UpdateContentTypeBody,
    force: boolean,
  ): Promise<ContentType> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const model = await this.model(tx, spaceId, env);
        const current = findContentType(model, apiId);

        let affected = 0;
        if (body.fields) {
          assertReferencesExist(referencesIn(body.fields), model, { contentType: apiId });
          const after = snapshot(model, { contentType: { ...current, fields: body.fields } });
          const entries = await this.entries.list(tx, model.environmentId, [current.id]);
          affected = affectedEntries(entries, snapshot(model), after);
          if (affected > 0 && !force) throw entriesInvalidated(affected, (n) => `This change would make ${n} invalid.`);
        }

        const [row] = await tx
          .update(contentTypes)
          .set({
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined ? { description: body.description ?? null } : {}),
            ...(body.fields !== undefined ? { fields: body.fields } : {}),
          })
          .where(eq(contentTypes.id, current.id))
          .returning();
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'content_type.updated',
          targetType: 'content_type',
          targetId: current.id,
          diff: { environment: env, apiId, changed: Object.keys(body), ...(affected ? { affectedEntries: affected } : {}) },
        });
        return toContentType(row);
      });
    } catch (error) {
      throw dbProblem(error, 'content type', apiId);
    }
  }

  async deleteContentType(user: AuthUser, spaceId: string, env: string, apiId: string, force: boolean): Promise<void> {
    try {
      await this.db.userDb(user.claims, async (tx) => {
        const model = await this.model(tx, spaceId, env);
        const current = findContentType(model, apiId);

        const users = typesReferencing(model, 'contentType', apiId, { contentType: apiId });
        if (users.length) {
          throw conflict('content_type_in_use', `${users.join(', ')} still point at this content type. Change them first.`);
        }
        const affected = (await this.entries.list(tx, model.environmentId, [current.id])).length;
        if (affected > 0 && !force) throw entriesInvalidated(affected, (n) => `This content type has ${n}.`);

        await tx.delete(contentTypes).where(eq(contentTypes.id, current.id));
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'content_type.deleted',
          targetType: 'content_type',
          targetId: current.id,
          diff: { environment: env, apiId, ...(affected ? { affectedEntries: affected } : {}) },
        });
      });
    } catch (error) {
      throw dbProblem(error, 'content type', apiId);
    }
  }

  // --- Block types -------------------------------------------------------------------------------

  listBlockTypes(user: AuthUser, spaceId: string, env: string): Promise<BlockType[]> {
    return this.db.userDb(user.claims, async (tx) => {
      const environmentId = await this.environmentId(tx, spaceId, env);
      const rows = await tx
        .select()
        .from(blockTypes)
        .where(and(eq(blockTypes.spaceId, spaceId), eq(blockTypes.environmentId, environmentId)))
        .orderBy(asc(blockTypes.name));
      return rows.map(toBlockType);
    });
  }

  getBlockType(user: AuthUser, spaceId: string, env: string, apiId: string): Promise<BlockType> {
    return this.db.userDb(user.claims, async (tx) => {
      const model = await this.model(tx, spaceId, env);
      return findBlockType(model, apiId);
    });
  }

  async createBlockType(user: AuthUser, spaceId: string, env: string, body: CreateBlockTypeBody): Promise<BlockType> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const model = await this.model(tx, spaceId, env);
        assertReferencesExist(blockTypeReferences(body.fields, body.allowedChildren), model, { blockType: body.apiId });

        const [row] = await tx
          .insert(blockTypes)
          .values({
            spaceId,
            environmentId: model.environmentId,
            apiId: body.apiId,
            name: body.name,
            icon: body.icon ?? null,
            previewImagePath: body.previewImagePath ?? null,
            fields: body.fields,
            allowedChildren: body.allowedChildren,
            styleOptions: body.styleOptions,
          })
          .returning();
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'block_type.created',
          targetType: 'block_type',
          targetId: row.id,
          diff: { environment: env, apiId: row.apiId },
        });
        return toBlockType(row);
      });
    } catch (error) {
      throw dbProblem(error, 'block type', body.apiId);
    }
  }

  async updateBlockType(
    user: AuthUser,
    spaceId: string,
    env: string,
    apiId: string,
    body: UpdateBlockTypeBody,
    force: boolean,
  ): Promise<BlockType> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const model = await this.model(tx, spaceId, env);
        const current = findBlockType(model, apiId);
        const next: BlockType = {
          ...current,
          fields: body.fields ?? current.fields,
          allowedChildren: body.allowedChildren ?? current.allowedChildren,
          styleOptions: body.styleOptions ?? current.styleOptions,
        };

        let affected = 0;
        if (body.fields || body.allowedChildren) {
          assertReferencesExist(blockTypeReferences(next.fields, next.allowedChildren), model, { blockType: apiId });
          const entries = await this.entries.list(tx, model.environmentId);
          affected = affectedEntries(entries, snapshot(model), snapshot(model, { blockType: next }));
          if (affected > 0 && !force) throw entriesInvalidated(affected, (n) => `This change would make ${n} invalid.`);
        }

        const schemaChanged =
          !sameJson(next.fields, current.fields) ||
          !sameJson(next.allowedChildren, current.allowedChildren) ||
          !sameJson(next.styleOptions, current.styleOptions);

        const [row] = await tx
          .update(blockTypes)
          .set({
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.icon !== undefined ? { icon: body.icon ?? null } : {}),
            ...(body.previewImagePath !== undefined ? { previewImagePath: body.previewImagePath ?? null } : {}),
            ...(body.fields !== undefined ? { fields: body.fields } : {}),
            ...(body.allowedChildren !== undefined ? { allowedChildren: body.allowedChildren } : {}),
            ...(body.styleOptions !== undefined ? { styleOptions: body.styleOptions } : {}),
            ...(schemaChanged ? { schemaVersion: sql`${blockTypes.schemaVersion} + 1` } : {}),
          })
          .where(eq(blockTypes.id, current.id))
          .returning();
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'block_type.updated',
          targetType: 'block_type',
          targetId: current.id,
          diff: {
            environment: env,
            apiId,
            changed: Object.keys(body),
            schemaVersion: row.schemaVersion,
            ...(affected ? { affectedEntries: affected } : {}),
          },
        });
        return toBlockType(row);
      });
    } catch (error) {
      throw dbProblem(error, 'block type', apiId);
    }
  }

  async deleteBlockType(user: AuthUser, spaceId: string, env: string, apiId: string, force: boolean): Promise<void> {
    try {
      await this.db.userDb(user.claims, async (tx) => {
        const model = await this.model(tx, spaceId, env);
        const current = findBlockType(model, apiId);

        const users = typesReferencing(model, 'blockType', apiId, { blockType: apiId });
        if (users.length) {
          throw conflict('block_type_in_use', `${users.join(', ')} still allow this block. Remove it from them first.`);
        }
        const entries = await this.entries.list(tx, model.environmentId);
        const affected = affectedEntries(entries, snapshot(model), snapshot(model, { withoutBlockType: apiId }));
        if (affected > 0 && !force) throw entriesInvalidated(affected, (n) => `Deleting this block type would make ${n} invalid.`);

        await tx.delete(blockTypes).where(eq(blockTypes.id, current.id));
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'block_type.deleted',
          targetType: 'block_type',
          targetId: current.id,
          diff: { environment: env, apiId, ...(affected ? { affectedEntries: affected } : {}) },
        });
      });
    } catch (error) {
      throw dbProblem(error, 'block type', apiId);
    }
  }

  // --- Helpers -----------------------------------------------------------------------------------

  /** The environment named `env` in the space (RLS hides other spaces' environments). */
  private async environmentId(tx: DbTransaction, spaceId: string, env: string): Promise<string> {
    const [row] = await tx
      .select({ id: environments.id })
      .from(environments)
      .where(and(eq(environments.spaceId, spaceId), eq(environments.name, env)));
    if (!row) throw notFound('environment_not_found', `This space has no "${env}" environment.`);
    return row.id;
  }

  private async model(tx: DbTransaction, spaceId: string, env: string): Promise<Model> {
    const environmentId = await this.environmentId(tx, spaceId, env);
    const [types, blocks] = await Promise.all([
      tx.select().from(contentTypes).where(eq(contentTypes.environmentId, environmentId)).orderBy(asc(contentTypes.name)),
      tx.select().from(blockTypes).where(eq(blockTypes.environmentId, environmentId)).orderBy(asc(blockTypes.name)),
    ]);
    return { environmentId, contentTypes: types.map(toContentType), blockTypes: blocks.map(toBlockType) };
  }
}

// --- Row mapping ---------------------------------------------------------------------------------

type ContentTypeRow = typeof contentTypes.$inferSelect;
type BlockTypeRow = typeof blockTypes.$inferSelect;

/** `fields` and `style_options` are written only by this service (validated) or the seed (tested). */
function toContentType(row: ContentTypeRow): ContentType {
  return {
    id: row.id,
    spaceId: row.spaceId,
    environmentId: row.environmentId,
    apiId: row.apiId,
    name: row.name,
    kind: row.kind as ContentTypeKind,
    description: row.description,
    fields: row.fields as FieldDef[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toBlockType(row: BlockTypeRow): BlockType {
  return {
    id: row.id,
    spaceId: row.spaceId,
    environmentId: row.environmentId,
    apiId: row.apiId,
    name: row.name,
    icon: row.icon,
    previewImagePath: row.previewImagePath,
    fields: row.fields as FieldDef[],
    allowedChildren: row.allowedChildren,
    styleOptions: row.styleOptions as StyleOptions,
    schemaVersion: row.schemaVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function findContentType(model: Model, apiId: string): ContentType {
  const type = model.contentTypes.find((t) => t.apiId === apiId);
  if (!type) throw notFound('content_type_not_found', `There is no content type "${apiId}" in this environment.`);
  return type;
}

function findBlockType(model: Model, apiId: string): BlockType {
  const type = model.blockTypes.find((t) => t.apiId === apiId);
  if (!type) throw notFound('block_type_not_found', `There is no block type "${apiId}" in this environment.`);
  return type;
}

// --- Model checks --------------------------------------------------------------------------------

function blockTypeReferences(fields: readonly FieldDef[], allowedChildren: readonly string[]): ModelReference[] {
  return [
    ...referencesIn(fields),
    ...allowedChildren.map((apiId, i): ModelReference => ({ kind: 'blockType', apiId, path: `allowedChildren.${i}` })),
  ];
}

/** Rejects references to types that do not exist. A type being created may refer to itself. */
function assertReferencesExist(
  references: readonly ModelReference[],
  model: Model,
  self: { contentType?: string; blockType?: string },
): void {
  const contentTypes = new Set(model.contentTypes.map((t) => t.apiId));
  const blockTypes = new Set(model.blockTypes.map((t) => t.apiId));
  if (self.contentType) contentTypes.add(self.contentType);
  if (self.blockType) blockTypes.add(self.blockType);

  const errors = unknownReferences(references, { contentTypes, blockTypes });
  if (Object.keys(errors).length) {
    throw new ProblemException(
      HttpStatus.BAD_REQUEST,
      'unknown_reference',
      'Unknown reference',
      'Some fields point at types that do not exist in this environment.',
      errors,
    );
  }
}

/** Names of the other types whose fields or allowed children mention `apiId`. */
function typesReferencing(
  model: Model,
  kind: ModelReference['kind'],
  apiId: string,
  self: { contentType?: string; blockType?: string },
): string[] {
  const mentions = (references: ModelReference[]) => references.some((r) => r.kind === kind && r.apiId === apiId);
  return [
    ...model.contentTypes.filter((t) => t.apiId !== self.contentType && mentions(referencesIn(t.fields))),
    ...model.blockTypes.filter(
      (t) => t.apiId !== self.blockType && mentions(blockTypeReferences(t.fields, t.allowedChildren)),
    ),
  ].map((t) => `${t.name} (${t.apiId})`);
}

/** The model as entry validation sees it, optionally with one type replaced or a block type removed. */
function snapshot(
  model: Model,
  change: { contentType?: ContentType; blockType?: BlockType; withoutBlockType?: string } = {},
): ModelSnapshot {
  return {
    contentTypes: model.contentTypes.map((t) => (t.id === change.contentType?.id ? change.contentType : t)),
    blockTypes: model.blockTypes
      .filter((t) => t.apiId !== change.withoutBlockType)
      .map((t) => (t.id === change.blockType?.id ? change.blockType : t)),
  };
}

/** 409 with the number of entries the change would break; `?force=true` applies it anyway. */
function entriesInvalidated(count: number, describe: (entries: string) => string): ProblemException {
  const entries = count === 1 ? '1 existing entry' : `${count} existing entries`;
  return new ProblemException(
    HttpStatus.CONFLICT,
    'entries_invalidated',
    'Conflict',
    `${describe(entries)} Send force=true to apply it anyway.`,
    undefined,
    { affectedEntries: count },
  );
}

/** Maps database errors to problems; anything else (including problems already thrown) passes through. */
function dbProblem(error: unknown, what: string, apiId: string): unknown {
  if (isUniqueViolation(error)) return conflict('api_id_taken', `A ${what} with the API id "${apiId}" already exists here.`);
  if (isInsufficientPrivilege(error)) return forbidden('insufficient_role', 'Only admins and developers can change the content model.');
  return error;
}

/** Deep equality for JSON values, ignoring object key order (Postgres `jsonb` reorders keys). */
function sameJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameJson(item, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    return (
      keysA.length === keysB.length &&
      keysA.every((key) => sameJson((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
    );
  }
  return a === b;
}
