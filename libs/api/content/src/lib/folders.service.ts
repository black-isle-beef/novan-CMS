import { Injectable } from '@nestjs/common';
import { badRequest, conflict, notFound } from '@novan/api-common';
import type { AuthUser } from '@novan/api-auth';
import { DbService, type DbTransaction, entries, folders, publishedContent, recordAudit } from '@novan/api-db';
import type { createFolderRequestSchema, Folder, updateFolderRequestSchema } from '@novan/shared-schemas';
import { and, asc, count, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { contentProblem } from './content-errors';
import { type ContentEvent, ContentEvents } from './content-events';
import { environmentId } from './entry-model';

type CreateBody = z.output<typeof createFolderRequestSchema>;
type UpdateBody = z.output<typeof updateFolderRequestSchema>;
type FolderRow = typeof folders.$inferSelect;

/**
 * Folders of an environment, which give pages their addresses. A folder's `path` is kept by the database:
 * renaming or moving one renames everything below it, published addresses included (and the database redirects the
 * old addresses, 0012_seo_site.sql).
 */
@Injectable()
export class FoldersService {
  constructor(
    private readonly db: DbService,
    private readonly events: ContentEvents,
  ) {}

  list(user: AuthUser, spaceId: string, env: string): Promise<Folder[]> {
    return this.db.userDb(user.claims, async (tx) => {
      const envId = await environmentId(tx, spaceId, env);
      const rows = await tx.select().from(folders).where(eq(folders.environmentId, envId)).orderBy(asc(folders.path));
      return rows.map(toFolder);
    });
  }

  async create(user: AuthUser, spaceId: string, env: string, body: CreateBody): Promise<Folder> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const envId = await environmentId(tx, spaceId, env);
        if (body.parentId) await findFolder(tx, envId, body.parentId, 'parent');
        const [row] = await tx
          .insert(folders)
          .values({ spaceId, environmentId: envId, parentId: body.parentId ?? null, name: body.name, slug: body.slug })
          .returning();
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'folder.created',
          targetType: 'folder',
          targetId: row.id,
          diff: { environment: env, path: row.path },
        });
        return toFolder(row);
      });
    } catch (error) {
      throw contentProblem(error);
    }
  }

  /** Renames or moves a folder; the pages inside move with it, published or not. */
  async update(user: AuthUser, spaceId: string, env: string, id: string, body: UpdateBody): Promise<Folder> {
    let event: ContentEvent | null = null;
    try {
      const result = await this.db.userDb(user.claims, async (tx) => {
        const envId = await environmentId(tx, spaceId, env);
        const current = await findFolder(tx, envId, id);
        if (body.parentId) await findFolder(tx, envId, body.parentId, 'parent');
        const below = sql`starts_with(${publishedContent.fullPath}, ${current.path + '/'})`;
        const published = await tx
          .select({ entryId: publishedContent.entryId, fullPath: publishedContent.fullPath, cacheTags: publishedContent.cacheTags })
          .from(publishedContent)
          .where(and(eq(publishedContent.environmentId, envId), below));

        const [row] = await tx
          .update(folders)
          .set({
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.slug !== undefined ? { slug: body.slug } : {}),
            ...(body.parentId !== undefined ? { parentId: body.parentId ?? null } : {}),
          })
          .where(eq(folders.id, id))
          .returning();
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'folder.updated',
          targetType: 'folder',
          targetId: id,
          diff: { environment: env, changed: Object.keys(body), ...(row.path !== current.path ? { from: current.path, to: row.path } : {}) },
        });
        if (row.path !== current.path && published.length) {
          event = {
            type: 'paths.changed',
            spaceId,
            environmentId: envId,
            entryIds: published.map((page) => page.entryId),
            cacheTags: published.flatMap((page) => page.cacheTags),
            paths: published.flatMap((page) => [page.fullPath, row.path + page.fullPath.slice(current.path.length)]),
            actorId: user.id,
          };
        }
        return toFolder(row);
      });
      if (event) this.events.emit(event);
      return result;
    } catch (error) {
      throw contentProblem(error);
    }
  }

  /** Deletes an empty folder. Anything of it still in the bin is restored to the top level instead. */
  async remove(user: AuthUser, spaceId: string, env: string, id: string): Promise<void> {
    try {
      await this.db.userDb(user.claims, async (tx) => {
        const envId = await environmentId(tx, spaceId, env);
        const folder = await findFolder(tx, envId, id);
        const [[subfolders], [live]] = await Promise.all([
          tx.select({ n: count() }).from(folders).where(eq(folders.parentId, id)),
          tx.select({ n: count() }).from(entries).where(and(eq(entries.folderId, id), isNull(entries.deletedAt))),
        ]);
        if (subfolders.n > 0 || live.n > 0) {
          throw conflict('folder_not_empty', 'Move or delete what is in this folder first.');
        }
        await tx.update(entries).set({ folderId: null }).where(and(eq(entries.folderId, id), isNotNull(entries.deletedAt)));
        await tx.delete(folders).where(eq(folders.id, id));
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'folder.deleted',
          targetType: 'folder',
          targetId: id,
          diff: { environment: env, path: folder.path },
        });
      });
    } catch (error) {
      throw contentProblem(error);
    }
  }
}

async function findFolder(tx: DbTransaction, envId: string, id: string, role: 'folder' | 'parent' = 'folder'): Promise<FolderRow> {
  const [row] = await tx
    .select()
    .from(folders)
    .where(and(eq(folders.id, id), eq(folders.environmentId, envId)));
  if (row) return row;
  throw role === 'parent'
    ? badRequest('folder_not_found', 'The parent folder does not exist here.')
    : notFound('folder_not_found', 'There is no such folder here.');
}

function toFolder(row: FolderRow): Folder {
  return {
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    slug: row.slug,
    path: row.path,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
