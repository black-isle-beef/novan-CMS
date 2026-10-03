import { HttpStatus } from '@nestjs/common';
import { notFound, ProblemException } from '@novan/api-common';
import { blockTypes, contentTypes, type DbTransaction, environments } from '@novan/api-db';
import {
  type BlockTypeDef,
  buildEntrySchema,
  type ContentTypeKind,
  type EntryData,
  type FieldDef,
  slugSchema,
} from '@novan/shared-schemas';
import { and, eq } from 'drizzle-orm';

/** What saving and publishing need to know about a content type. */
export interface EntryContentType {
  id: string;
  apiId: string;
  name: string;
  kind: ContentTypeKind;
  fields: FieldDef[];
}

/** One environment's content model, loaded once per request. */
export interface EntryModel {
  environmentId: string;
  contentTypes: EntryContentType[];
  blockTypes: BlockTypeDef[];
}

/** The environment named `env` in the space (RLS hides other spaces' environments). */
export async function environmentId(tx: DbTransaction, spaceId: string, env: string): Promise<string> {
  const [row] = await tx
    .select({ id: environments.id })
    .from(environments)
    .where(and(eq(environments.spaceId, spaceId), eq(environments.name, env)));
  if (!row) throw notFound('environment_not_found', `This space has no "${env}" environment.`);
  return row.id;
}

export async function loadModel(tx: DbTransaction, spaceId: string, env: string): Promise<EntryModel> {
  const id = await environmentId(tx, spaceId, env);
  const [types, blocks] = await Promise.all([
    tx
      .select({
        id: contentTypes.id,
        apiId: contentTypes.apiId,
        name: contentTypes.name,
        kind: contentTypes.kind,
        fields: contentTypes.fields,
      })
      .from(contentTypes)
      .where(eq(contentTypes.environmentId, id)),
    tx
      .select({ apiId: blockTypes.apiId, fields: blockTypes.fields, allowedChildren: blockTypes.allowedChildren })
      .from(blockTypes)
      .where(eq(blockTypes.environmentId, id)),
  ]);
  // `fields` is written only by the content model API (validated) or the seed (tested).
  return {
    environmentId: id,
    contentTypes: types.map((type) => ({ ...type, kind: type.kind as ContentTypeKind, fields: type.fields as FieldDef[] })),
    blockTypes: blocks.map((block) => ({ ...block, fields: block.fields as FieldDef[] })),
  };
}

export function contentTypeByApiId(model: EntryModel, apiId: string): EntryContentType {
  const type = model.contentTypes.find((t) => t.apiId === apiId);
  if (!type) throw notFound('content_type_not_found', `There is no content type "${apiId}" in this environment.`);
  return type;
}

export function contentTypeById(model: EntryModel, id: string): EntryContentType {
  // Entries reference their type with a foreign key, so it is always there.
  return model.contentTypes.find((t) => t.id === id) as EntryContentType;
}

/**
 * Validates entry data with `buildEntrySchema` (a draft may be incomplete; publishing needs it complete)
 * and returns it as stored: defaults filled in, unknown keys dropped.
 */
export function validateData(model: EntryModel, type: EntryContentType, data: unknown, mode: 'draft' | 'publish'): EntryData {
  const schema = buildEntrySchema(type.fields, { blockTypes: model.blockTypes, draft: mode === 'draft' });
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const errors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.') || '(root)';
    (errors[path] ??= []).push(issue.message);
  }
  throw new ProblemException(
    HttpStatus.BAD_REQUEST,
    'entry_invalid',
    'Invalid content',
    mode === 'publish' ? 'Some fields need attention before this can be published.' : 'Some fields need attention.',
    errors,
  );
}

/** Whether the type keeps the entry's slug in a top-level `slug` text field (the seeded `page` type does). */
export function hasSlugField(type: EntryContentType): boolean {
  return type.fields.some((field) => field.apiId === 'slug' && field.type === 'text');
}

/**
 * The slug held in the data's `slug` field: a valid slug, `null` when the field is empty (a draft may be
 * incomplete), or a 400 when it is filled in but not a slug.
 */
export function slugInData(type: EntryContentType, data: EntryData): string | null {
  if (!hasSlugField(type)) return null;
  const value = data['slug'];
  if (typeof value !== 'string' || value.trim() === '') return null;
  const result = slugSchema.safeParse(value);
  if (result.success) return result.data;
  throw new ProblemException(HttpStatus.BAD_REQUEST, 'entry_invalid', 'Invalid content', 'Some fields need attention.', {
    slug: result.error.issues.map((issue) => issue.message),
  });
}
