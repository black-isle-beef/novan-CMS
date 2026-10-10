import { Injectable } from '@nestjs/common';
import { type AuthUser } from '@novan/api-auth';
import { badRequest, conflict, forbidden, notFound, ProblemException } from '@novan/api-common';
import {
  contentTypes,
  DbService,
  type DbTransaction,
  entries,
  entryVersions,
  environments,
  folders,
  isCheckViolation,
  isUniqueViolation,
  profiles,
  recordAudit,
  releaseItems,
  releases,
  scheduledActions,
} from '@novan/api-db';
import {
  type createReleaseRequestSchema,
  type EntryData,
  entryTitle,
  type putReleaseItemRequestSchema,
  type Release,
  type ReleaseDetail,
  type ReleaseItem,
  type ReleaseStatus,
  type scheduleReleaseRequestSchema,
  type updateReleaseRequestSchema,
} from '@novan/shared-schemas';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { contentProblem } from './content-errors';
import { closeReview, EntriesService, findEntry, liveEntry, workflowOf } from './entries.service';
import { contentTypeById, environmentId, loadAssets, loadModel, slugInData, validateData } from './entry-model';
import { entryPath } from './paths';
import { scheduleRefusal } from './workflow';

type CreateBody = z.output<typeof createReleaseRequestSchema>;
type UpdateBody = z.output<typeof updateReleaseRequestSchema>;
type PutItemBody = z.output<typeof putReleaseItemRequestSchema>;
type ScheduleBody = z.output<typeof scheduleReleaseRequestSchema>;
type ReleaseRow = typeof releases.$inferSelect;

/**
 * Releases (docs/build/17-scheduling-releases-webhooks.md): pages that go live together, each at a chosen version.
 * Publishing one publishes every page in one transaction, or none when one cannot be (a page is incomplete, archived,
 * in the bin, or the person may not publish it); the CDN purge jobs are sent in that transaction, so they run after it
 * commits. A release can be scheduled like a page (0015). Every query runs as the caller under RLS (0016).
 */
@Injectable()
export class ReleasesService {
  constructor(
    private readonly db: DbService,
    private readonly entries: EntriesService,
  ) {}

  list(user: AuthUser, spaceId: string, env: string): Promise<Release[]> {
    return this.db.userDb(user.claims, async (tx) => {
      const envId = await environmentId(tx, spaceId, env);
      return readReleases(tx, eq(releases.environmentId, envId));
    });
  }

  get(user: AuthUser, spaceId: string, env: string, id: string): Promise<ReleaseDetail> {
    return this.db.userDb(user.claims, async (tx) => readDetail(tx, await this.find(tx, spaceId, env, id)));
  }

  async create(user: AuthUser, spaceId: string, env: string, body: CreateBody): Promise<ReleaseDetail> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const envId = await environmentId(tx, spaceId, env);
        const [row] = await tx.insert(releases).values({ spaceId, environmentId: envId, name: body.name, createdBy: user.id }).returning();
        await audit(tx, user, row, 'release.created', { name: body.name });
        return readDetail(tx, row);
      });
    } catch (error) {
      throw releaseProblem(error);
    }
  }

  async update(user: AuthUser, spaceId: string, env: string, id: string, body: UpdateBody): Promise<ReleaseDetail> {
    return this.change(user, spaceId, env, id, async (tx, release) => {
      await tx.update(releases).set({ name: body.name }).where(eq(releases.id, release.id));
      await audit(tx, user, release, 'release.updated', { from: release.name, to: body.name });
    });
  }

  /** Deletes a release that has not been published; a waiting schedule goes with it. */
  async remove(user: AuthUser, spaceId: string, env: string, id: string): Promise<void> {
    try {
      await this.db.userDb(user.claims, async (tx) => {
        const release = await this.find(tx, spaceId, env, id);
        unpublished(release);
        const deleted = await tx.delete(releases).where(eq(releases.id, release.id)).returning({ id: releases.id });
        if (!deleted.length) throw forbidden('insufficient_role', 'Releases need an editor.');
        await audit(tx, user, release, 'release.deleted', { name: release.name });
      });
    } catch (error) {
      throw releaseProblem(error);
    }
  }

  /** Adds a page to the release, or changes which version of it the release publishes (its current one by default). */
  async putItem(user: AuthUser, spaceId: string, env: string, id: string, entryId: string, body: PutItemBody): Promise<ReleaseDetail> {
    return this.change(user, spaceId, env, id, async (tx, release) => {
      const entry = await liveEntry(tx, release.environmentId, entryId);
      const versionId = body.versionId ?? (entry.currentVersionId as string);
      const [version] = await tx
        .select({ id: entryVersions.id })
        .from(entryVersions)
        .where(and(eq(entryVersions.id, versionId), eq(entryVersions.entryId, entry.id)));
      if (!version) throw notFound('version_not_found', 'This version does not belong to this page.');
      await tx
        .insert(releaseItems)
        .values({ releaseId: release.id, spaceId, environmentId: release.environmentId, entryId: entry.id, versionId })
        .onConflictDoUpdate({ target: [releaseItems.releaseId, releaseItems.entryId], set: { versionId } });
      await audit(tx, user, release, 'release.item_added', { entryId: entry.id, versionId });
    });
  }

  async removeItem(user: AuthUser, spaceId: string, env: string, id: string, entryId: string): Promise<ReleaseDetail> {
    return this.change(user, spaceId, env, id, async (tx, release) => {
      const removed = await tx
        .delete(releaseItems)
        .where(and(eq(releaseItems.releaseId, release.id), eq(releaseItems.entryId, entryId)))
        .returning({ entryId: releaseItems.entryId });
      if (!removed.length) throw notFound('release_item_not_found', 'This page is not in the release.');
      await audit(tx, user, release, 'release.item_removed', { entryId });
    });
  }

  /** Publishes every page of the release now, in one transaction. A waiting schedule is cancelled. */
  async publish(user: AuthUser, spaceId: string, env: string, id: string): Promise<ReleaseDetail> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const release = await this.find(tx, spaceId, env, id);
        await this.publishIn(tx, user, release, env);
        return readDetail(tx, (await this.find(tx, spaceId, env, id)));
      });
    } catch (error) {
      throw releaseProblem(error);
    }
  }

  /** The worker's half of a scheduled release (`ScheduledActionRunner`): publishes it if it is still scheduled. */
  async publishScheduled(user: AuthUser, spaceId: string, releaseId: string): Promise<void> {
    try {
      await this.db.userDb(user.claims, async (tx) => {
        const [row] = await tx
          .select({ release: releases, env: environments.name })
          .from(releases)
          .innerJoin(environments, eq(environments.id, releases.environmentId))
          .where(and(eq(releases.id, releaseId), eq(releases.spaceId, spaceId)));
        if (!row) throw notFound('release_not_found', 'This release no longer exists.');
        if (row.release.status !== 'scheduled') throw conflict('release_not_scheduled', 'This release is no longer scheduled.');
        await this.publishIn(tx, user, row.release, row.env);
      });
    } catch (error) {
      throw releaseProblem(error);
    }
  }

  async schedule(user: AuthUser, spaceId: string, env: string, id: string, body: ScheduleBody): Promise<ReleaseDetail> {
    const runAt = new Date(body.runAt);
    if (runAt.getTime() <= Date.now()) throw badRequest('run_at_past', 'Choose a time in the future.');
    return this.change(user, spaceId, env, id, async (tx, release) => {
      if (release.status === 'scheduled') throw conflict('already_scheduled', 'This release is already scheduled. Cancel it to choose another time.');
      await this.checkMayPublish(tx, user, release);
      await tx.insert(scheduledActions).values({ spaceId, releaseId: release.id, action: 'publish', runAt: runAt.toISOString(), createdBy: user.id });
      await tx.update(releases).set({ status: 'scheduled', scheduledAt: runAt.toISOString(), error: null }).where(eq(releases.id, release.id));
      await audit(tx, user, release, 'release.scheduled', { runAt: runAt.toISOString() });
    });
  }

  async cancelSchedule(user: AuthUser, spaceId: string, env: string, id: string): Promise<ReleaseDetail> {
    return this.change(user, spaceId, env, id, async (tx, release) => {
      const cancelled = await tx
        .update(scheduledActions)
        .set({ status: 'cancelled', finishedAt: sql`now()` })
        .where(and(eq(scheduledActions.releaseId, release.id), eq(scheduledActions.status, 'scheduled')))
        .returning({ id: scheduledActions.id });
      if (!cancelled.length || release.status !== 'scheduled') throw conflict('not_waiting', 'This release is not waiting to be published.');
      await tx.update(releases).set({ status: 'draft', scheduledAt: null }).where(eq(releases.id, release.id));
      await audit(tx, user, release, 'release.schedule_cancelled', { runAt: release.scheduledAt });
    });
  }

  /**
   * Publishes every page in `tx`: all are checked first (who is asking, and each page's version against today's model),
   * so a problem with one stops them all and names every page that has one.
   */
  private async publishIn(tx: DbTransaction, user: AuthUser, release: ReleaseRow, env: string): Promise<void> {
    unpublished(release);
    const items = await tx.select().from(releaseItems).where(eq(releaseItems.releaseId, release.id)).orderBy(asc(releaseItems.addedAt));
    if (!items.length) throw badRequest('release_empty', 'Add a page to the release first.');
    const model = await loadModel(tx, release.spaceId, env);

    const ready = [];
    const errors: Record<string, string[]> = {};
    for (const item of items) {
      const entry = await findEntry(tx, release.environmentId, item.entryId);
      const label = entry.slug;
      if (entry.deletedAt) {
        errors[label] = ['This page is in the bin. Restore it or take it out of the release.'];
        continue;
      }
      const flow = await workflowOf(tx, user, entry);
      const refused = scheduleRefusal('publish', flow, flow.actor);
      if (refused) {
        if (refused.code !== 'workflow_state') throw forbidden(refused.code, refused.detail);
        errors[label] = [refused.detail];
        continue;
      }
      const type = contentTypeById(model, entry.contentTypeId);
      const [version] = await tx.select({ data: entryVersions.data }).from(entryVersions).where(eq(entryVersions.id, item.versionId));
      try {
        const data = validateData(model, type, version.data, 'publish', await loadAssets(tx, release.spaceId, model, type, version.data));
        ready.push({ entry, flow, versionId: item.versionId, data, slug: slugInData(type, data) ?? entry.slug });
      } catch (error) {
        if (!(error instanceof ProblemException)) throw error;
        errors[label] = Object.entries(error.errors ?? {}).map(([field, messages]) => `${field}: ${messages.join(' ')}`);
        if (!errors[label].length) errors[label] = [error.toProblem().detail ?? 'This page cannot be published.'];
      }
    }
    if (Object.keys(errors).length) {
      throw badRequest('release_invalid', 'Some pages in this release cannot be published. Nothing was published.', errors);
    }

    for (const { entry, flow, versionId, data, slug } of ready) {
      const path = await this.entries.goLive(tx, model, entry, versionId, data, slug, user);
      await closeReview(tx, entry.id, flow.state === 'in_review' ? 'approved' : 'withdrawn', user);
      await recordAudit(tx, {
        spaceId: release.spaceId,
        actorId: user.id,
        action: 'entry.published',
        targetType: 'entry',
        targetId: entry.id,
        diff: { environment: env, versionId, path, releaseId: release.id, ...(entry.publishedVersionId ? { previousVersionId: entry.publishedVersionId } : {}) },
      });
    }
    await tx
      .update(scheduledActions)
      .set({ status: 'cancelled', finishedAt: sql`now()` })
      .where(and(eq(scheduledActions.releaseId, release.id), eq(scheduledActions.status, 'scheduled')));
    await tx
      .update(releases)
      .set({ status: 'published', scheduledAt: null, error: null, publishedAt: sql`now()`, publishedBy: user.id })
      .where(eq(releases.id, release.id));
    await audit(tx, user, release, 'release.published', { pages: ready.length });
  }

  /** Whether the caller may publish every page of the release, as `scheduleRefusal` decides for each. */
  private async checkMayPublish(tx: DbTransaction, user: AuthUser, release: ReleaseRow): Promise<void> {
    const items = await tx.select({ entryId: releaseItems.entryId }).from(releaseItems).where(eq(releaseItems.releaseId, release.id));
    for (const item of items) {
      const entry = await findEntry(tx, release.environmentId, item.entryId);
      const flow = await workflowOf(tx, user, entry);
      const refused = scheduleRefusal('publish', flow, flow.actor);
      if (refused && refused.code !== 'workflow_state') throw forbidden(refused.code, refused.detail);
    }
  }

  private async change(
    user: AuthUser,
    spaceId: string,
    env: string,
    id: string,
    apply: (tx: DbTransaction, release: ReleaseRow) => Promise<void>,
  ): Promise<ReleaseDetail> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const release = await this.find(tx, spaceId, env, id);
        unpublished(release);
        await apply(tx, release);
        return readDetail(tx, await this.find(tx, spaceId, env, id));
      });
    } catch (error) {
      throw releaseProblem(error);
    }
  }

  private async find(tx: DbTransaction, spaceId: string, env: string, id: string): Promise<ReleaseRow> {
    const envId = await environmentId(tx, spaceId, env);
    const [row] = await tx.select().from(releases).where(and(eq(releases.id, id), eq(releases.environmentId, envId)));
    if (!row) throw notFound('release_not_found', 'There is no such release here.');
    return row;
  }
}

function unpublished(release: ReleaseRow): void {
  if (release.status === 'published') throw conflict('release_published', 'This release has been published and cannot change.');
}

function audit(tx: DbTransaction, user: AuthUser, release: ReleaseRow, action: string, diff: Record<string, unknown>): Promise<void> {
  return recordAudit(tx, { spaceId: release.spaceId, actorId: user.id, action, targetType: 'release', targetId: release.id, diff });
}

async function readReleases(tx: DbTransaction, where: ReturnType<typeof eq>): Promise<Release[]> {
  const rows = await tx
    .select({ release: releases, createdByName: profiles.displayName })
    .from(releases)
    .leftJoin(profiles, eq(profiles.userId, releases.createdBy))
    .where(where)
    .orderBy(desc(releases.createdAt), desc(releases.id));
  if (!rows.length) return [];
  const counts = await tx
    .select({ releaseId: releaseItems.releaseId, n: count() })
    .from(releaseItems)
    .where(inArray(releaseItems.releaseId, rows.map((row) => row.release.id)))
    .groupBy(releaseItems.releaseId);
  const byRelease = new Map(counts.map((c) => [c.releaseId, c.n]));
  return rows.map(({ release, createdByName }) => toRelease(release, createdByName, byRelease.get(release.id) ?? 0));
}

async function readDetail(tx: DbTransaction, release: ReleaseRow): Promise<ReleaseDetail> {
  const [summary] = await readReleases(tx, eq(releases.id, release.id));
  const rows = await tx
    .select({
      item: releaseItems,
      slug: entries.slug,
      currentVersionId: entries.currentVersionId,
      publishedVersionId: entries.publishedVersionId,
      folderPath: folders.path,
      contentType: contentTypes.apiId,
      data: entryVersions.data,
    })
    .from(releaseItems)
    .innerJoin(entries, eq(entries.id, releaseItems.entryId))
    .innerJoin(contentTypes, eq(contentTypes.id, entries.contentTypeId))
    .innerJoin(entryVersions, eq(entryVersions.id, releaseItems.versionId))
    .leftJoin(folders, eq(folders.id, entries.folderId))
    .where(eq(releaseItems.releaseId, release.id))
    .orderBy(asc(releaseItems.addedAt));
  const items: ReleaseItem[] = rows.map((row) => ({
    entryId: row.item.entryId,
    versionId: row.item.versionId,
    title: entryTitle(row.data as EntryData, row.slug),
    path: entryPath(row.folderPath, row.slug),
    contentType: row.contentType,
    current: row.item.versionId === row.currentVersionId,
    live: row.item.versionId === row.publishedVersionId,
    addedAt: row.item.addedAt,
  }));
  return { ...summary, items };
}

function toRelease(release: ReleaseRow, createdByName: string | null, itemCount: number): Release {
  return {
    id: release.id,
    name: release.name,
    status: release.status as ReleaseStatus,
    scheduledAt: release.scheduledAt,
    error: release.error,
    createdBy: release.createdBy,
    createdByName,
    createdAt: release.createdAt,
    publishedAt: release.publishedAt,
    publishedBy: release.publishedBy,
    itemCount,
  };
}

function releaseProblem(error: unknown): unknown {
  if (isUniqueViolation(error, 'scheduled_actions_waiting_release_idx')) {
    return conflict('already_scheduled', 'This release is already scheduled. Cancel it to choose another time.');
  }
  if (isCheckViolation(error) && String((error as { cause?: Error }).cause?.message ?? error).includes('future')) {
    return badRequest('run_at_past', 'Choose a time in the future.');
  }
  return contentProblem(error);
}
