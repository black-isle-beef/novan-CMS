import { contentTypes, type Database, entries, entryVersions, folders, publishedContent } from '@novan/api-db';
import { HOME_SLUG } from '@novan/shared-schemas';
import { and, eq, isNull, sql } from 'drizzle-orm';
// Named so the inferred return type of `contentSource` can be written out in declarations.
import type { PgColumn, SubqueryWithSelection } from 'drizzle-orm/pg-core';
import type { ApiTokenAccess } from './api-token-resolver';

/**
 * Where an API reads from, as one subquery with the same columns for both:
 * - delivery: `published_content`, the copy made on publish, and nothing else, so drafts never leak;
 * - preview: live entries (not in the bin) at their current version, with their draft address.
 * Both are always limited to the token's space and environment.
 */
export function contentSource(db: Database, access: ApiTokenAccess) {
  if (access.scope === 'delivery') {
    return db
      .select({
        id: publishedContent.entryId,
        contentType: publishedContent.contentTypeApiId,
        kind: contentTypes.kind,
        path: publishedContent.fullPath,
        locale: publishedContent.locale,
        updatedAt: publishedContent.publishedAt,
        data: publishedContent.data,
      })
      .from(publishedContent)
      .innerJoin(
        contentTypes,
        and(eq(contentTypes.environmentId, publishedContent.environmentId), eq(contentTypes.apiId, publishedContent.contentTypeApiId)),
      )
      .where(and(eq(publishedContent.spaceId, access.spaceId), eq(publishedContent.environmentId, access.environmentId)))
      .as('src');
  }
  return db
    .select({
      id: entries.id,
      contentType: contentTypes.apiId,
      kind: contentTypes.kind,
      path: sql<string>`coalesce(${folders.path}, '') || '/' || ${entries.slug}`.as('path'),
      locale: entries.locale,
      updatedAt: entries.updatedAt,
      data: entryVersions.data,
    })
    .from(entries)
    .innerJoin(contentTypes, eq(contentTypes.id, entries.contentTypeId))
    .innerJoin(entryVersions, eq(entryVersions.id, entries.currentVersionId))
    .leftJoin(folders, eq(folders.id, entries.folderId))
    .where(and(eq(entries.spaceId, access.spaceId), eq(entries.environmentId, access.environmentId), isNull(entries.deletedAt)))
    .as('src');
}

export type ContentSource = ReturnType<typeof contentSource>;

/** The top-level `home` page is the site's `/`. */
export const publicPath = (path: string): string => (path === `/${HOME_SLUG}` ? '/' : path);
export const storedPath = (path: string): string => (path === '/' ? `/${HOME_SLUG}` : path);

/** ISO 8601 in UTC with microseconds, e.g. `2026-10-04T09:30:00.123456+00:00`. */
export const isoTimestamp = (column: unknown) => sql<string>`to_json(${column}) #>> '{}'`;
