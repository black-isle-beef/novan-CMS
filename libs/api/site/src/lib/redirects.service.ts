import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@novan/api-auth';
import { conflict, forbidden, notFound } from '@novan/api-common';
import { ContentEvents } from '@novan/api-content';
import {
  DbService,
  type DbTransaction,
  environments,
  isInsufficientPrivilege,
  isUniqueViolation,
  profiles,
  publishedContent,
  recordAudit,
  redirects,
} from '@novan/api-db';
import {
  type createRedirectRequestSchema,
  HOME_SLUG,
  type ImportRedirectsResult,
  type importRedirectsRequestSchema,
  type Redirect,
  type RedirectStatus,
  type updateRedirectRequestSchema,
} from '@novan/shared-schemas';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';

type CreateBody = z.output<typeof createRedirectRequestSchema>;
type UpdateBody = z.output<typeof updateRedirectRequestSchema>;
type ImportBody = z.output<typeof importRedirectsRequestSchema>;
type RedirectRow = typeof redirects.$inferSelect;

/** How many redirects one statement writes during an import. */
const IMPORT_BATCH = 500;

/**
 * A space's redirects (docs/build/14-seo-site-features.md). Every query runs as the caller under RLS: members read
 * them, editors and up change them. A redirect may not start at the address of a published page (the site would
 * never show the page), nor go straight back to where another redirect comes from. Changes are audited and announced
 * on {@link ContentEvents}, which purges the CDN.
 */
@Injectable()
export class RedirectsService {
  constructor(
    private readonly db: DbService,
    private readonly events: ContentEvents,
  ) {}

  list(user: AuthUser, spaceId: string): Promise<Redirect[]> {
    return this.db.userDb(user.claims, async (tx) => {
      const rows = await tx
        .select({ redirect: redirects, createdByName: profiles.displayName })
        .from(redirects)
        .leftJoin(profiles, eq(profiles.userId, redirects.createdBy))
        .where(eq(redirects.spaceId, spaceId))
        .orderBy(asc(redirects.fromPath));
      return rows.map(({ redirect, createdByName }) => toRedirect(redirect, createdByName));
    });
  }

  create(user: AuthUser, spaceId: string, body: CreateBody): Promise<Redirect> {
    return this.write(user, spaceId, async (tx) => {
      await checkTarget(tx, spaceId, body.fromPath, body.toPath, null);
      const [row] = await tx
        .insert(redirects)
        .values({ spaceId, fromPath: body.fromPath, toPath: body.toPath, status: body.status, createdBy: user.id })
        .returning();
      await recordAudit(tx, {
        spaceId,
        actorId: user.id,
        action: 'redirect.created',
        targetType: 'redirect',
        targetId: row.id,
        diff: { fromPath: row.fromPath, toPath: row.toPath, status: row.status },
      });
      return { row, paths: [row.fromPath] };
    });
  }

  update(user: AuthUser, spaceId: string, id: string, body: UpdateBody): Promise<Redirect> {
    return this.write(user, spaceId, async (tx) => {
      const current = await findRedirect(tx, spaceId, id);
      const fromPath = body.fromPath ?? current.fromPath;
      const toPath = body.toPath ?? current.toPath;
      if (fromPath === toPath) throw conflict('redirect_loop', 'A redirect cannot go to the same address.');
      await checkTarget(tx, spaceId, fromPath, toPath, id);
      const [row] = await tx
        .update(redirects)
        .set({ fromPath, toPath, status: body.status ?? current.status })
        .where(eq(redirects.id, id))
        .returning();
      await recordAudit(tx, {
        spaceId,
        actorId: user.id,
        action: 'redirect.updated',
        targetType: 'redirect',
        targetId: id,
        diff: {
          from: { fromPath: current.fromPath, toPath: current.toPath, status: current.status },
          to: { fromPath: row.fromPath, toPath: row.toPath, status: row.status },
        },
      });
      return { row, paths: [...new Set([current.fromPath, row.fromPath])] };
    });
  }

  async remove(user: AuthUser, spaceId: string, id: string): Promise<void> {
    try {
      await this.db.userDb(user.claims, async (tx) => {
        const current = await findRedirect(tx, spaceId, id);
        const deleted = await tx.delete(redirects).where(eq(redirects.id, id)).returning({ id: redirects.id });
        // RLS hides the row from roles that may not delete it, so nothing is deleted.
        if (!deleted.length) throw forbidden('insufficient_role', 'Your role cannot change redirects. Ask an editor.');
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'redirect.deleted',
          targetType: 'redirect',
          targetId: id,
          diff: { fromPath: current.fromPath, toPath: current.toPath, status: current.status },
        });
        await this.events.emit(tx, { type: 'redirects.changed', spaceId, paths: [current.fromPath], actorId: user.id });
      });
    } catch (error) {
      throw redirectProblem(error);
    }
  }

  /**
   * Adds the redirects, replacing those from the same addresses. Ones that would hide a published page are skipped
   * and reported; the rest are written in one transaction.
   */
  async import(user: AuthUser, spaceId: string, body: ImportBody): Promise<ImportRedirectsResult> {
    try {
      return await this.db.userDb(user.claims, async (tx): Promise<ImportRedirectsResult> => {
        const live = await livePaths(tx, spaceId, body.redirects.map((r) => r.fromPath));
        const skipped = body.redirects
          .filter((r) => live.has(r.fromPath))
          .map((r) => ({ fromPath: r.fromPath, message: 'A published page has this address. Move or unpublish the page first.' }));
        const wanted = body.redirects.filter((r) => !live.has(r.fromPath));
        if (!wanted.length) return { created: 0, updated: 0, skipped };

        const existing = new Set<string>();
        for (let i = 0; i < wanted.length; i += IMPORT_BATCH) {
          const batch = wanted.slice(i, i + IMPORT_BATCH);
          const rows = await tx
            .select({ fromPath: redirects.fromPath })
            .from(redirects)
            .where(and(eq(redirects.spaceId, spaceId), inArray(redirects.fromPath, batch.map((r) => r.fromPath))));
          for (const row of rows) existing.add(row.fromPath);
          await tx
            .insert(redirects)
            .values(batch.map((r) => ({ spaceId, fromPath: r.fromPath, toPath: r.toPath, status: r.status, createdBy: user.id })))
            .onConflictDoUpdate({
              target: [redirects.spaceId, redirects.fromPath],
              set: { toPath: sqlExcluded('to_path'), status: sqlExcluded('status') },
            });
        }
        const updated = wanted.filter((r) => existing.has(r.fromPath)).length;
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'redirects.imported',
          targetType: 'redirect',
          diff: { created: wanted.length - updated, updated, skipped: skipped.length },
        });
        await this.events.emit(tx, { type: 'redirects.changed', spaceId, paths: wanted.map((r) => r.fromPath), actorId: user.id });
        return { created: wanted.length - updated, updated, skipped };
      });
    } catch (error) {
      throw redirectProblem(error);
    }
  }

  /** Runs one change to a redirect and announces it in the same transaction. */
  private async write(
    user: AuthUser,
    spaceId: string,
    change: (tx: DbTransaction) => Promise<{ row: RedirectRow; paths: string[] }>,
  ): Promise<Redirect> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const { row, paths } = await change(tx);
        const [author] = row.createdBy
          ? await tx.select({ name: profiles.displayName }).from(profiles).where(eq(profiles.userId, row.createdBy))
          : [];
        await this.events.emit(tx, { type: 'redirects.changed', spaceId, paths, actorId: user.id });
        return toRedirect(row, author?.name ?? null);
      });
    } catch (error) {
      throw redirectProblem(error);
    }
  }
}

// --- Helpers -------------------------------------------------------------------------------------

/** `excluded.<column>` in `on conflict do update`. */
const sqlExcluded = (column: 'to_path' | 'status') => sql.raw(`excluded.${column}`);

async function findRedirect(tx: DbTransaction, spaceId: string, id: string): Promise<RedirectRow> {
  const [row] = await tx
    .select()
    .from(redirects)
    .where(and(eq(redirects.id, id), eq(redirects.spaceId, spaceId)));
  if (!row) throw notFound('redirect_not_found', 'This redirect does not exist, or has been deleted.');
  return row;
}

/** Of these site addresses, those a published page of the main environment answers at. */
async function livePaths(tx: DbTransaction, spaceId: string, paths: readonly string[]): Promise<Set<string>> {
  const stored = (path: string) => (path === '/' ? `/${HOME_SLUG}` : path);
  const live = new Set<string>();
  for (let i = 0; i < paths.length; i += IMPORT_BATCH) {
    const batch = paths.slice(i, i + IMPORT_BATCH);
    const rows = await tx
      .select({ fullPath: publishedContent.fullPath })
      .from(publishedContent)
      .innerJoin(environments, and(eq(environments.id, publishedContent.environmentId), eq(environments.isMain, true)))
      .where(and(eq(publishedContent.spaceId, spaceId), inArray(publishedContent.fullPath, batch.map(stored))));
    for (const row of rows) live.add(row.fullPath === `/${HOME_SLUG}` ? '/' : row.fullPath);
  }
  return live;
}

/**
 * Refuses a redirect from a published page's address, or one that would send visitors straight back to where they
 * came from (an existing redirect from `toPath` to `fromPath`).
 */
async function checkTarget(tx: DbTransaction, spaceId: string, fromPath: string, toPath: string, id: string | null): Promise<void> {
  if ((await livePaths(tx, spaceId, [fromPath])).size) {
    throw conflict('redirect_hides_page', `A published page is at ${fromPath}. Move or unpublish the page first, or redirect another address.`);
  }
  const target = toPath.split(/[?#]/, 1)[0];
  const [back] = await tx
    .select({ id: redirects.id })
    .from(redirects)
    .where(and(eq(redirects.spaceId, spaceId), eq(redirects.fromPath, target), eq(redirects.toPath, fromPath)));
  if (back && back.id !== id) {
    throw conflict('redirect_loop', `${target} already redirects to ${fromPath}, so visitors would go round in a loop.`);
  }
}

function redirectProblem(error: unknown): unknown {
  if (isUniqueViolation(error, 'redirects_space_id_from_path_key')) {
    return conflict('redirect_exists', 'There is already a redirect from this address. Change that one instead.');
  }
  if (isInsufficientPrivilege(error)) return forbidden('insufficient_role', 'Your role cannot change redirects. Ask an editor.');
  return error;
}

function toRedirect(row: RedirectRow, createdByName: string | null): Redirect {
  return {
    id: row.id,
    fromPath: row.fromPath,
    toPath: row.toPath,
    status: row.status as RedirectStatus,
    automatic: row.createdBy === null,
    createdBy: row.createdBy,
    createdByName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
