import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { badRequest, conflict, forbidden, MACHINE_TRANSLATOR, notFound, ProblemException, type Translator } from '@novan/api-common';
import { type AuthUser, hasStaffAccess, type SpaceAccess } from '@novan/api-auth';
import {
  assetUsages,
  completeOnboardingStep,
  contentTypes,
  DbService,
  type DbTransaction,
  entries,
  entryVersions,
  folders,
  profiles,
  publishedContent,
  isCheckViolation,
  isUniqueViolation,
  recordAudit,
  reviewRequests,
  scheduledActions,
  spaceLocales,
  spaces,
} from '@novan/api-db';
import {
  type autosaveEntryRequestSchema,
  type ContentTypeKind,
  type createEntryRequestSchema,
  diffEntryData,
  type Entry,
  type EntryData,
  type EntryDiff,
  type EntryStatus,
  type EntrySummary,
  type EntryVersion,
  entryTitle,
  HOME_SLUG,
  type listEntriesQuerySchema,
  localesMissingTranslations,
  type MachineTranslation,
  machineTranslationMessage,
  type MediaRef,
  mediaRefs,
  type moveEntryRequestSchema,
  type PendingReview,
  type ReviewDecision,
  type ReviewRequest,
  type ScheduledAction,
  type ScheduledActionKind,
  type ScheduledActionStatus,
  type scheduleActionRequestSchema,
  slugify,
  type translateEntryRequestSchema,
  type updateEntryRequestSchema,
  type WorkflowAction,
  type EntryWorkflow,
  type WorkflowState,
} from '@novan/shared-schemas';
import { alias } from 'drizzle-orm/pg-core';
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { canPublish } from './content-access';
import { contentProblem } from './content-errors';
import { ContentEvents, type EntryUnpublishedEvent } from './content-events';
import { allowedActions, refusal, scheduleRefusal, storedStatus, type WorkflowActor, workflowState } from './workflow';
import { type NotifiedPage, WorkflowNotifier } from './workflow-notifier';
import {
  contentTypeByApiId,
  contentTypeById,
  type EntryModel,
  environmentId,
  hasSlugField,
  loadAssets,
  loadModel,
  modelOf,
  slugInData,
  validateData,
} from './entry-model';
import { planTranslation } from './machine-translation';
import { cacheTags, entryPath, lastSegment } from './paths';

type ListQuery = z.output<typeof listEntriesQuerySchema>;
type CreateBody = z.output<typeof createEntryRequestSchema>;
type UpdateBody = z.output<typeof updateEntryRequestSchema>;
type AutosaveBody = z.output<typeof autosaveEntryRequestSchema>;
type MoveBody = z.output<typeof moveEntryRequestSchema>;
type TranslateBody = z.output<typeof translateEntryRequestSchema>;
type ScheduleBody = z.output<typeof scheduleActionRequestSchema>;

type EntryRow = typeof entries.$inferSelect;

/** How long autosave keeps overwriting its own version before starting a new one (see 0006_entries.sql). */
const AUTOSAVE_WINDOW_MS = 2 * 60 * 1000;

/** A text field of the current version; a translated one in the space's default locale. */
const textSql = (key: string) => sql`nullif(btrim(case jsonb_typeof(${entryVersions.data} -> ${key})
  when 'object' then ${entryVersions.data} -> ${key} ->> (
    select l.code from ${spaceLocales} l where l.space_id = ${entries.spaceId} and l.is_default
  )
  else ${entryVersions.data} ->> ${key}
end), '')`;

/** Title shown in lists: the current version's `title` or `name`, else the slug (as `entryTitle`). */
const titleSql = sql<string>`coalesce(${textSql('title')}, ${textSql('name')}, ${entries.slug})`;

const summaryColumns = {
  entry: entries,
  contentType: { apiId: contentTypes.apiId, name: contentTypes.name, kind: contentTypes.kind },
  folderPath: folders.path,
  title: titleSql,
  data: entryVersions.data,
};

/**
 * Entries of an environment and their versions. Every query runs as the caller under RLS
 * (`DbService.userDb`). Saving creates a new immutable version and points the entry at it; publishing
 * and restoring only move pointers and copy the version into `published_content`. Publish, unpublish,
 * restore, bin and move are audited in the same transaction; publish and unpublish are announced on
 * {@link ContentEvents} once committed.
 */
@Injectable()
export class EntriesService {
  constructor(
    private readonly db: DbService,
    private readonly events: ContentEvents,
    private readonly notifier: WorkflowNotifier,
    @Inject(MACHINE_TRANSLATOR) private readonly translator: Translator | null,
  ) {}

  list(user: AuthUser, spaceId: string, env: string, query: ListQuery): Promise<EntrySummary[]> {
    return this.db.userDb(user.claims, async (tx) => {
      const envId = await environmentId(tx, spaceId, env);
      const filters: (SQL | undefined)[] = [
        eq(entries.environmentId, envId),
        query.deleted ? isNotNull(entries.deletedAt) : isNull(entries.deletedAt),
        query.contentType ? eq(contentTypes.apiId, query.contentType) : undefined,
        query.folderId === 'root' ? isNull(entries.folderId) : query.folderId ? eq(entries.folderId, query.folderId) : undefined,
      ];
      if (query.search) {
        const pattern = `%${query.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        filters.push(or(ilike(titleSql, pattern), ilike(entries.slug, pattern)));
      }
      const rows = await tx
        .select(summaryColumns)
        .from(entries)
        .innerJoin(contentTypes, eq(contentTypes.id, entries.contentTypeId))
        .innerJoin(entryVersions, eq(entryVersions.id, entries.currentVersionId))
        .leftJoin(folders, eq(folders.id, entries.folderId))
        .where(and(...filters))
        .orderBy(asc(folders.path), asc(entries.slug));
      const model = await modelOf(tx, spaceId, envId);
      return rows.map((row) => toSummary(row, model));
    });
  }

  get(user: AuthUser, spaceId: string, env: string, id: string): Promise<Entry> {
    return this.db.userDb(user.claims, async (tx) => {
      const envId = await environmentId(tx, spaceId, env);
      return readEntry(tx, envId, id);
    });
  }

  async create(user: AuthUser, spaceId: string, env: string, body: CreateBody): Promise<Entry> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const model = await loadModel(tx, spaceId, env);
        const type = contentTypeByApiId(model, body.contentType);
        if (body.folderId) await folderPath(tx, model.environmentId, body.folderId);

        // The slug comes from the data's slug field, else the request, else the title.
        const slug = slugInData(type, body.data) ?? body.slug ?? (slugify(entryTitle(body.data, '')) || null);
        if (!slug) throw badRequest('slug_required', 'Give it a title or a slug, so it has an address.');
        const input = hasSlugField(type) ? { ...body.data, slug } : body.data;
        const data = validateData(model, type, input, 'draft', await loadAssets(tx, spaceId, model, type, input));

        const [entry] = await tx
          .insert(entries)
          .values({
            spaceId,
            environmentId: model.environmentId,
            contentTypeId: type.id,
            folderId: body.folderId ?? null,
            slug,
            createdBy: user.id,
          })
          .returning();
        await saveVersion(tx, entry, user, data, { message: body.message ?? null, autosave: false, slug });
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'entry.created',
          targetType: 'entry',
          targetId: entry.id,
          diff: { environment: env, contentType: type.apiId, slug },
        });
        if (type.kind === 'page') await completeOnboardingStep(tx, spaceId, 'newPage');
        return readEntry(tx, model.environmentId, entry.id);
      });
    } catch (error) {
      throw contentProblem(error);
    }
  }

  /** Saves the data as a new version and makes it the current one. */
  async update(user: AuthUser, spaceId: string, env: string, id: string, body: UpdateBody): Promise<Entry> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const model = await loadModel(tx, spaceId, env);
        const entry = await liveEntry(tx, model.environmentId, id);
        const flow = await workflowOf(tx, user, entry);
        check(flow, 'edit');
        const type = contentTypeById(model, entry.contentTypeId);
        const data = validateData(model, type, body.data, 'draft', await loadAssets(tx, spaceId, model, type, body.data));
        await saveVersion(tx, entry, user, data, {
          message: body.message ?? null,
          autosave: false,
          slug: slugInData(type, data) ?? entry.slug,
        });
        await leaveReview(tx, entry, flow, user);
        if (isHomePage(entry, type)) await completeOnboardingStep(tx, spaceId, 'homePage');
        return readEntry(tx, model.environmentId, id);
      });
    } catch (error) {
      throw contentProblem(error);
    }
  }

  /**
   * Overwrites the caller's own autosave when it is the current, unpublished version and less than two
   * minutes old; otherwise saves a new autosave version. Keeps autosave from creating a version every
   * few seconds.
   */
  async autosave(user: AuthUser, spaceId: string, env: string, id: string, body: AutosaveBody): Promise<Entry> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const model = await loadModel(tx, spaceId, env);
        const entry = await liveEntry(tx, model.environmentId, id);
        const flow = await workflowOf(tx, user, entry);
        check(flow, 'edit');
        const type = contentTypeById(model, entry.contentTypeId);
        const data = validateData(model, type, body.data, 'draft', await loadAssets(tx, spaceId, model, type, body.data));
        const slug = slugInData(type, data) ?? entry.slug;

        const [current] = await tx.select().from(entryVersions).where(eq(entryVersions.id, entry.currentVersionId as string));
        const overwrite =
          current.autosave &&
          current.createdBy === user.id &&
          current.id !== entry.publishedVersionId &&
          Date.now() - Date.parse(current.createdAt) < AUTOSAVE_WINDOW_MS;
        // The database applies the same window (now() is the transaction's start), so a version that
        // just aged out is not overwritten.
        const overwritten = overwrite
          ? await tx
              .update(entryVersions)
              .set({ data })
              .where(and(eq(entryVersions.id, current.id), sql`${entryVersions.createdAt} > now() - interval '2 minutes'`))
              .returning({ id: entryVersions.id })
          : [];

        if (overwritten.length) {
          await tx.update(entries).set({ slug }).where(eq(entries.id, entry.id));
        } else {
          await saveVersion(tx, entry, user, data, { message: null, autosave: true, slug });
        }
        await leaveReview(tx, entry, flow, user);
        if (isHomePage(entry, type)) await completeOnboardingStep(tx, spaceId, 'homePage');
        return readEntry(tx, model.environmentId, id);
      });
    } catch (error) {
      throw contentProblem(error);
    }
  }

  /**
   * Validates the current version in full, copies it into `published_content` and points `published_version_id` at it.
   * With a message, the version is saved again with it first. Publishing a published page refreshes its live copy.
   */
  async publish(user: AuthUser, spaceId: string, env: string, id: string, message: string | null = null): Promise<Entry> {
    return this.publishAs('publish', user, spaceId, env, id, message);
  }

  /** Publishes a page waiting for review (space admins and agency staff), and tells whoever sent it. */
  approve(user: AuthUser, spaceId: string, env: string, id: string, message: string | null = null): Promise<Entry> {
    return this.publishAs('approve', user, spaceId, env, id, message);
  }

  private async publishAs(
    action: 'publish' | 'approve',
    user: AuthUser,
    spaceId: string,
    env: string,
    id: string,
    message: string | null,
  ): Promise<Entry> {
    let notify: { page: NotifiedPage; requester: string | null; path: string } | null = null;
    try {
      const result = await this.db.userDb(user.claims, async (tx) => {
        const model = await loadModel(tx, spaceId, env);
        let entry = await liveEntry(tx, model.environmentId, id);
        const flow = await workflowOf(tx, user, entry);
        check(flow, action);
        const type = contentTypeById(model, entry.contentTypeId);
        const [version] = await tx
          .select({ data: entryVersions.data, message: entryVersions.message })
          .from(entryVersions)
          .where(eq(entryVersions.id, entry.currentVersionId as string));
        const data = validateData(model, type, version.data, 'publish', await loadAssets(tx, spaceId, model, type, version.data));
        if (message && message !== version.message) {
          await saveVersion(tx, entry, user, data, { message, autosave: false, slug: entry.slug });
          entry = await findEntry(tx, model.environmentId, id);
        }
        const versionId = entry.currentVersionId as string;

        const path = entryPath(entry.folderId ? await folderPath(tx, model.environmentId, entry.folderId) : null, entry.slug);
        const tags = cacheTags({ id: entry.id, environmentId: model.environmentId, contentType: type.apiId });
        // now() is the transaction's start, so both rows get the same time.
        const published = {
          spaceId,
          environmentId: model.environmentId,
          contentTypeApiId: type.apiId,
          fullPath: path,
          data,
          publishedAt: sql`now()`,
          cacheTags: tags,
        };
        await tx
          .insert(publishedContent)
          .values({ entryId: entry.id, ...published })
          .onConflictDoUpdate({ target: publishedContent.entryId, set: published });
        await tx
          .update(entries)
          .set({ status: 'published', publishedVersionId: versionId, publishedAt: sql`now()` })
          .where(eq(entries.id, entry.id));
        await recordUsages(tx, entry, mediaRefs(type.fields, data, model.blockTypes));
        const review = await closeReview(tx, entry.id, flow.state === 'in_review' ? 'approved' : 'withdrawn', user);
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: action === 'approve' ? 'entry.approved' : 'entry.published',
          targetType: 'entry',
          targetId: entry.id,
          diff: {
            environment: env,
            versionId,
            path,
            ...(entry.publishedVersionId ? { previousVersionId: entry.publishedVersionId } : {}),
            ...(message ? { message } : {}),
          },
        });
        await completeOnboardingStep(tx, spaceId, 'publish');

        const saved = await readEntry(tx, model.environmentId, id);
        await this.events.emit(tx, {
          type: 'entry.published',
          spaceId,
          environmentId: model.environmentId,
          entryId: entry.id,
          contentType: type.apiId,
          path,
          cacheTags: tags,
          actorId: user.id,
          versionId,
          publishedAt: saved.publishedAt as string,
        });
        if (flow.state === 'in_review') notify = { page: page(saved, spaceId), requester: review?.requestedBy ?? null, path };
        return saved;
      });
      const sent = notify as { page: NotifiedPage; requester: string | null; path: string } | null;
      if (sent) await this.notifier.published(sent.page, sent.requester, user.id, sitePathOf(sent.path));
      return result;
    } catch (error) {
      throw contentProblem(error);
    }
  }

  /** Sends the page for review: it waits for a space admin, who gets an email. */
  async submit(user: AuthUser, spaceId: string, env: string, id: string, message: string | null = null): Promise<Entry> {
    let notify: NotifiedPage | null = null;
    try {
      const result = await this.db.userDb(user.claims, async (tx) => {
        const envId = await environmentId(tx, spaceId, env);
        const entry = await liveEntry(tx, envId, id);
        check(await workflowOf(tx, user, entry), 'submit');
        await tx.insert(reviewRequests).values({
          spaceId,
          entryId: entry.id,
          versionId: entry.currentVersionId as string,
          message,
          requestedBy: user.id,
        });
        await tx.update(entries).set({ status: 'in_review' }).where(eq(entries.id, entry.id));
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'entry.submitted',
          targetType: 'entry',
          targetId: entry.id,
          diff: { environment: env, versionId: entry.currentVersionId, ...(message ? { message } : {}) },
        });
        const saved = await readEntry(tx, envId, id);
        notify = page(saved, spaceId);
        return saved;
      });
      if (notify) await this.notifier.reviewRequested(notify, user.id, message);
      return result;
    } catch (error) {
      throw contentProblem(error);
    }
  }

  /** Sends the page back to whoever asked for the review, with what to change. */
  async requestChanges(user: AuthUser, spaceId: string, env: string, id: string, comment: string): Promise<Entry> {
    let notify: { page: NotifiedPage; requester: string | null } | null = null;
    try {
      const result = await this.db.userDb(user.claims, async (tx) => {
        const envId = await environmentId(tx, spaceId, env);
        const entry = await liveEntry(tx, envId, id);
        const flow = await workflowOf(tx, user, entry);
        check(flow, 'requestChanges');
        const review = await closeReview(tx, entry.id, 'changes_requested', user, comment);
        await tx.update(entries).set({ status: storedStatus('draft', flow.live) }).where(eq(entries.id, entry.id));
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'entry.changes_requested',
          targetType: 'entry',
          targetId: entry.id,
          diff: { environment: env, comment },
        });
        const saved = await readEntry(tx, envId, id);
        notify = { page: page(saved, spaceId), requester: review?.requestedBy ?? null };
        return saved;
      });
      const sent = notify as { page: NotifiedPage; requester: string | null } | null;
      if (sent) await this.notifier.changesRequested(sent.page, sent.requester, user.id, comment);
      return result;
    } catch (error) {
      throw contentProblem(error);
    }
  }

  /** Takes the page off the site (if it is on it) and out of the way, until restored. */
  async archive(user: AuthUser, spaceId: string, env: string, id: string): Promise<Entry> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const model = await loadModel(tx, spaceId, env);
        const entry = await liveEntry(tx, model.environmentId, id);
        check(await workflowOf(tx, user, entry), 'archive');
        if (entry.publishedVersionId) await this.events.emit(tx, await takeOffline(tx, model, entry, user));
        await tx.update(entries).set({ status: 'archived' }).where(eq(entries.id, entry.id));
        await closeReview(tx, entry.id, 'withdrawn', user);
        await cancelWaitingActions(tx, entry.id);
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'entry.archived',
          targetType: 'entry',
          targetId: entry.id,
          diff: { environment: env, wasPublished: Boolean(entry.publishedVersionId) },
        });
        return readEntry(tx, model.environmentId, id);
      });
    } catch (error) {
      throw contentProblem(error);
    }
  }

  /** Brings an archived page back as a draft. */
  async unarchive(user: AuthUser, spaceId: string, env: string, id: string): Promise<Entry> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const envId = await environmentId(tx, spaceId, env);
        const entry = await liveEntry(tx, envId, id);
        check(await workflowOf(tx, user, entry), 'restore');
        await tx.update(entries).set({ status: 'draft' }).where(eq(entries.id, entry.id));
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'entry.unarchived',
          targetType: 'entry',
          targetId: entry.id,
          diff: { environment: env },
        });
        return readEntry(tx, envId, id);
      });
    } catch (error) {
      throw contentProblem(error);
    }
  }

  /** The page's place in the workflow, what the caller may do with it, and its latest review. */
  workflow(user: AuthUser, spaceId: string, env: string, id: string): Promise<EntryWorkflow> {
    return this.db.userDb(user.claims, async (tx) => {
      const envId = await environmentId(tx, spaceId, env);
      const entry = await findEntry(tx, envId, id);
      const flow = await workflowOf(tx, user, entry);
      const [review] = await reviewsOf(tx, eq(reviewRequests.entryId, entry.id))
        .orderBy(sql`${reviewRequests.decision} is null desc`, desc(reviewRequests.requestedAt))
        .limit(1);
      return {
        state: flow.state,
        requireApproval: flow.requireApproval,
        live: flow.live,
        actions: entry.deletedAt ? [] : allowedActions(flow, flow.actor),
        review: review ? toReview(review) : null,
      };
    });
  }

  /** Pages waiting for review in the environment, oldest first (the reviewer inbox). */
  reviews(user: AuthUser, spaceId: string, env: string): Promise<PendingReview[]> {
    return this.db.userDb(user.claims, async (tx) => {
      const envId = await environmentId(tx, spaceId, env);
      const open = await reviewsOf(tx, and(isNull(reviewRequests.decision), eq(reviewRequests.spaceId, spaceId))).orderBy(
        asc(reviewRequests.requestedAt),
      );
      if (!open.length) return [];
      const rows = await tx
        .select(summaryColumns)
        .from(entries)
        .innerJoin(contentTypes, eq(contentTypes.id, entries.contentTypeId))
        .innerJoin(entryVersions, eq(entryVersions.id, entries.currentVersionId))
        .leftJoin(folders, eq(folders.id, entries.folderId))
        .where(and(inArray(entries.id, open.map((row) => row.request.entryId)), eq(entries.environmentId, envId), isNull(entries.deletedAt)));
      const model = await modelOf(tx, spaceId, envId);
      const summaries = new Map(rows.map((row) => [row.entry.id, toSummary(row, model)]));
      return open.flatMap((row) => {
        const entry = summaries.get(row.request.entryId);
        return entry ? [{ ...toReview(row), entry }] : [];
      });
    });
  }

  /** The page's scheduled publishing and unpublishing, newest first (the last 20). */
  scheduledActions(user: AuthUser, spaceId: string, env: string, id: string): Promise<ScheduledAction[]> {
    return this.db.userDb(user.claims, async (tx) => {
      const envId = await environmentId(tx, spaceId, env);
      const entry = await findEntry(tx, envId, id);
      return readScheduledActions(tx, eq(scheduledActions.entryId, entry.id), 20);
    });
  }

  /**
   * Schedules the page to be published or unpublished at `runAt` (stored in UTC). Whether the caller may is checked now,
   * as for publishing (`scheduleRefusal`); when it runs, the worker does it as them, with their role then, and the
   * page is checked as it is then (docs/build/17-scheduling-releases-webhooks.md).
   */
  async schedule(user: AuthUser, spaceId: string, env: string, id: string, body: ScheduleBody): Promise<ScheduledAction> {
    const runAt = new Date(body.runAt);
    if (runAt.getTime() <= Date.now()) throw badRequest('run_at_past', 'Choose a time in the future.');
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const envId = await environmentId(tx, spaceId, env);
        const entry = await liveEntry(tx, envId, id);
        const flow = await workflowOf(tx, user, entry);
        const refused = scheduleRefusal(body.action, flow, flow.actor);
        if (refused) throw refused.code === 'workflow_state' ? conflict(refused.code, refused.detail) : forbidden(refused.code, refused.detail);
        const [row] = await tx
          .insert(scheduledActions)
          .values({ spaceId, entryId: entry.id, action: body.action, runAt: runAt.toISOString(), createdBy: user.id })
          .returning({ id: scheduledActions.id });
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'entry.scheduled',
          targetType: 'entry',
          targetId: entry.id,
          diff: { environment: env, scheduledActionId: row.id, action: body.action, runAt: runAt.toISOString() },
        });
        const [saved] = await readScheduledActions(tx, eq(scheduledActions.id, row.id), 1);
        return saved;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'scheduled_actions_waiting_idx')) {
        throw conflict('already_scheduled', `This page already has a scheduled ${body.action}. Cancel it to choose another time.`);
      }
      // The database's own check that the time is still in the future (0015_scheduling.sql).
      if (isCheckViolation(error)) throw badRequest('run_at_past', 'Choose a time in the future.');
      throw contentProblem(error);
    }
  }

  /** Cancels a scheduled action that has not run yet. */
  async cancelScheduled(user: AuthUser, spaceId: string, env: string, id: string, actionId: string): Promise<ScheduledAction> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const envId = await environmentId(tx, spaceId, env);
        const entry = await findEntry(tx, envId, id);
        const [existing] = await readScheduledActions(tx, and(eq(scheduledActions.id, actionId), eq(scheduledActions.entryId, entry.id)), 1);
        if (!existing) throw notFound('scheduled_action_not_found', 'Nothing like this is scheduled for this page.');
        const cancelled = await tx
          .update(scheduledActions)
          .set({ status: 'cancelled', finishedAt: sql`now()` })
          .where(and(eq(scheduledActions.id, actionId), eq(scheduledActions.status, 'scheduled')))
          .returning({ id: scheduledActions.id });
        if (!cancelled.length) throw conflict('not_waiting', 'This has already happened, or was cancelled.');
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'entry.schedule_cancelled',
          targetType: 'entry',
          targetId: entry.id,
          diff: { environment: env, scheduledActionId: actionId, action: existing.action, runAt: existing.runAt },
        });
        const [saved] = await readScheduledActions(tx, eq(scheduledActions.id, actionId), 1);
        return saved;
      });
    } catch (error) {
      throw contentProblem(error);
    }
  }

  /** Live pages and entries whose draft or published content points at this one (references and internal links). */
  references(user: AuthUser, spaceId: string, env: string, id: string): Promise<EntrySummary[]> {
    return this.db.userDb(user.claims, async (tx) => {
      const envId = await environmentId(tx, spaceId, env);
      const entry = await findEntry(tx, envId, id);
      // Ids are UUIDs, so their text appears in data only where something points at them.
      const pattern = `%${entry.id}%`;
      const rows = await tx
        .select(summaryColumns)
        .from(entries)
        .innerJoin(contentTypes, eq(contentTypes.id, entries.contentTypeId))
        .innerJoin(entryVersions, eq(entryVersions.id, entries.currentVersionId))
        .leftJoin(folders, eq(folders.id, entries.folderId))
        .leftJoin(publishedContent, eq(publishedContent.entryId, entries.id))
        .where(
          and(
            eq(entries.environmentId, envId),
            isNull(entries.deletedAt),
            ne(entries.id, entry.id),
            or(sql`${entryVersions.data}::text like ${pattern}`, sql`${publishedContent.data}::text like ${pattern}`),
          ),
        )
        .orderBy(asc(folders.path), asc(entries.slug));
      const model = await modelOf(tx, spaceId, envId);
      return rows.map((row) => toSummary(row, model));
    });
  }

  async unpublish(user: AuthUser, spaceId: string, env: string, id: string): Promise<Entry> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const model = await loadModel(tx, spaceId, env);
        const entry = await liveEntry(tx, model.environmentId, id);
        check(await workflowOf(tx, user, entry), 'unpublish');

        const event = await takeOffline(tx, model, entry, user);
        await this.events.emit(tx, event);
        await closeReview(tx, entry.id, 'withdrawn', user);
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'entry.unpublished',
          targetType: 'entry',
          targetId: entry.id,
          diff: { environment: env, versionId: entry.publishedVersionId, path: event.path },
        });
        return readEntry(tx, model.environmentId, id);
      });
    } catch (error) {
      throw contentProblem(error);
    }
  }

  /**
   * Fills the empty translations of locale `to` from `from` (the default locale when left out) with the machine
   * translator, and saves the result as a draft version whose message says it was machine-translated, so it is
   * checked before anyone publishes it (docs/build/16-localisation.md). The translator is called outside any
   * transaction; if the page changed meanwhile, nothing is saved.
   */
  async translate(user: AuthUser, spaceId: string, env: string, id: string, body: TranslateBody): Promise<MachineTranslation> {
    const translator = this.translator;
    if (!translator) {
      throw new ProblemException(HttpStatus.NOT_IMPLEMENTED, 'translation_unavailable', 'Machine translation unavailable', 'Machine translation is not set up for this site.');
    }
    try {
      const planned = await this.db.userDb(user.claims, async (tx) => {
        const model = await loadModel(tx, spaceId, env);
        const entry = await liveEntry(tx, model.environmentId, id);
        check(await workflowOf(tx, user, entry), 'edit');
        const { defaultLocale } = model.localeSettings;
        const from = body.from ?? defaultLocale;
        const to = model.locales.locales.find((locale) => locale.code === body.to);
        if (!to || !model.locales.locales.some((locale) => locale.code === from)) {
          throw badRequest('locale_not_found', 'Translate between two of the space\'s locales.');
        }
        if (to.code === from) throw badRequest('same_locale', 'Choose a different locale to translate into.');
        const [version] = await tx.select({ data: entryVersions.data }).from(entryVersions).where(eq(entryVersions.id, entry.currentVersionId as string));
        const type = contentTypeById(model, entry.contentTypeId);
        const plan = planTranslation(type.fields, version.data as EntryData, model.blockTypes, { from, to: to.code, defaultLocale });
        return { plan, versionId: entry.currentVersionId, from, to };
      });
      const { plan, versionId, from, to } = planned;
      const translated = plan.texts.length ? await translator.translate(plan.texts, from, to.code) : [];

      return await this.db.userDb(user.claims, async (tx) => {
        const model = await loadModel(tx, spaceId, env);
        const entry = await liveEntry(tx, model.environmentId, id);
        if (!plan.paths.length) return { entry: await readEntry(tx, model.environmentId, id, model), translated: [], provider: translator.name };
        if (entry.currentVersionId !== versionId) {
          throw conflict('entry_changed', 'The page changed while it was being translated. Try again.');
        }
        const flow = await workflowOf(tx, user, entry);
        check(flow, 'edit');
        const type = contentTypeById(model, entry.contentTypeId);
        const input = plan.apply(translated);
        const data = validateData(model, type, input, 'draft', await loadAssets(tx, spaceId, model, type, input));
        await saveVersion(tx, entry, user, data, { message: machineTranslationMessage(to.name), autosave: false, slug: entry.slug });
        await leaveReview(tx, entry, flow, user);
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'entry.machine_translated',
          targetType: 'entry',
          targetId: entry.id,
          diff: { environment: env, from, to: to.code, provider: translator.name, values: plan.paths.length },
        });
        return { entry: await readEntry(tx, model.environmentId, id, model), translated: plan.paths, provider: translator.name };
      });
    } catch (error) {
      throw contentProblem(error);
    }
  }

  /** Makes an earlier version the current one again. It is checked against today's content model first. */
  async restoreVersion(user: AuthUser, spaceId: string, env: string, id: string, versionId: string): Promise<Entry> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const model = await loadModel(tx, spaceId, env);
        const entry = await liveEntry(tx, model.environmentId, id);
        const [version] = await tx
          .select({ id: entryVersions.id, data: entryVersions.data })
          .from(entryVersions)
          .where(and(eq(entryVersions.id, versionId), eq(entryVersions.entryId, entry.id)));
        if (!version) throw notFound('version_not_found', 'This version does not belong to this entry.');
        if (version.id === entry.currentVersionId) return readEntry(tx, model.environmentId, id);
        const flow = await workflowOf(tx, user, entry);
        check(flow, 'edit');
        await leaveReview(tx, entry, flow, user);

        const type = contentTypeById(model, entry.contentTypeId);
        const data = validateData(model, type, version.data, 'draft', await loadAssets(tx, spaceId, model, type, version.data));
        await tx
          .update(entries)
          .set({ currentVersionId: version.id, slug: slugInData(type, data) ?? entry.slug })
          .where(eq(entries.id, entry.id));
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'entry.version_restored',
          targetType: 'entry',
          targetId: entry.id,
          diff: { environment: env, versionId: version.id, previousVersionId: entry.currentVersionId },
        });
        return readEntry(tx, model.environmentId, id);
      });
    } catch (error) {
      throw contentProblem(error);
    }
  }

  /** Moves the entry to the bin, taking it off the site first if it is published. */
  async remove(user: AuthUser, spaceId: string, env: string, id: string): Promise<void> {
    try {
      await this.db.userDb(user.claims, async (tx) => {
        const model = await loadModel(tx, spaceId, env);
        const entry = await liveEntry(tx, model.environmentId, id);
        if (entry.publishedVersionId) await this.events.emit(tx, await takeOffline(tx, model, entry, user));
        // A page in review comes back from the bin as a draft, its request closed.
        await tx
          .update(entries)
          .set({ deletedAt: sql`now()`, ...(entry.status === 'in_review' ? { status: 'draft' } : {}) })
          .where(eq(entries.id, entry.id));
        await closeReview(tx, entry.id, 'withdrawn', user);
        await cancelWaitingActions(tx, entry.id);
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'entry.deleted',
          targetType: 'entry',
          targetId: entry.id,
          diff: { environment: env, slug: entry.slug, wasPublished: Boolean(entry.publishedVersionId) },
        });
      });
    } catch (error) {
      throw contentProblem(error);
    }
  }

  /** Takes the entry out of the bin, as a draft. */
  async restore(user: AuthUser, spaceId: string, env: string, id: string): Promise<Entry> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const envId = await environmentId(tx, spaceId, env);
        const entry = await findEntry(tx, envId, id);
        if (!entry.deletedAt) throw conflict('entry_not_deleted', 'This is not in the bin.');
        await tx.update(entries).set({ deletedAt: null }).where(eq(entries.id, entry.id));
        await recordAudit(tx, {
          spaceId,
          actorId: user.id,
          action: 'entry.restored',
          targetType: 'entry',
          targetId: entry.id,
          diff: { environment: env, slug: entry.slug },
        });
        return readEntry(tx, envId, id);
      });
    } catch (error) {
      throw contentProblem(error);
    }
  }

  /**
   * Moves the entry to another folder. A published entry's address moves straight away, so that needs an editor; the
   * database redirects its old address to the new one (0012_seo_site.sql).
   */
  async move(user: AuthUser, space: SpaceAccess, env: string, id: string, body: MoveBody): Promise<Entry> {
    try {
      return await this.db.userDb(user.claims, async (tx) => {
        const envId = await environmentId(tx, space.id, env);
        const entry = await liveEntry(tx, envId, id);
        if (entry.publishedVersionId && !canPublish(user, space)) {
          throw forbidden('insufficient_role', 'Moving a published page changes its address, so it needs an editor.');
        }
        if (entry.folderId === body.folderId) return readEntry(tx, envId, id);

        const target = body.folderId ? await folderPath(tx, envId, body.folderId) : null;
        await tx.update(entries).set({ folderId: body.folderId }).where(eq(entries.id, entry.id));

        let path: string | null = null;
        if (entry.publishedVersionId) {
          const [published] = await tx
            .select({ fullPath: publishedContent.fullPath, cacheTags: publishedContent.cacheTags })
            .from(publishedContent)
            .where(eq(publishedContent.entryId, entry.id));
          // The published slug can differ from a newer draft's, so keep it.
          path = entryPath(target, lastSegment(published.fullPath));
          await tx.update(publishedContent).set({ fullPath: path }).where(eq(publishedContent.entryId, entry.id));
          await this.events.emit(tx, {
            type: 'paths.changed',
            spaceId: space.id,
            environmentId: envId,
            entryIds: [entry.id],
            cacheTags: published.cacheTags,
            paths: [published.fullPath, path],
            actorId: user.id,
          });
        }
        await recordAudit(tx, {
          spaceId: space.id,
          actorId: user.id,
          action: 'entry.moved',
          targetType: 'entry',
          targetId: entry.id,
          diff: { environment: env, fromFolderId: entry.folderId, toFolderId: body.folderId, ...(path ? { publishedPath: path } : {}) },
        });
        return readEntry(tx, envId, id);
      });
    } catch (error) {
      throw contentProblem(error);
    }
  }

  /** Newest first, with who saved each and whether it is the current or published one. */
  versions(user: AuthUser, spaceId: string, env: string, id: string): Promise<EntryVersion[]> {
    return this.db.userDb(user.claims, async (tx) => {
      const envId = await environmentId(tx, spaceId, env);
      const entry = await findEntry(tx, envId, id);
      const rows = await tx
        .select({ version: entryVersions, createdByName: profiles.displayName })
        .from(entryVersions)
        .leftJoin(profiles, eq(profiles.userId, entryVersions.createdBy))
        .where(eq(entryVersions.entryId, entry.id))
        .orderBy(desc(entryVersions.createdAt), desc(entryVersions.id));
      return rows.map(({ version, createdByName }) => ({
        id: version.id,
        entryId: version.entryId,
        message: version.message,
        autosave: version.autosave,
        createdBy: version.createdBy,
        createdByName,
        createdAt: version.createdAt,
        current: version.id === entry.currentVersionId,
        published: version.id === entry.publishedVersionId,
      }));
    });
  }

  /** What changed from version `from` to version `to` of the same entry, with blocks matched by `_uid`. */
  diff(user: AuthUser, spaceId: string, env: string, from: string, to: string): Promise<EntryDiff> {
    return this.db.userDb(user.claims, async (tx) => {
      const envId = await environmentId(tx, spaceId, env);
      const rows = await tx
        .select({ id: entryVersions.id, entryId: entryVersions.entryId, data: entryVersions.data })
        .from(entryVersions)
        .innerJoin(entries, eq(entries.id, entryVersions.entryId))
        .where(and(inArray(entryVersions.id, [from, to]), eq(entries.environmentId, envId)));
      const before = rows.find((row) => row.id === from);
      const after = rows.find((row) => row.id === to);
      if (!before || !after) throw notFound('version_not_found', 'One of these versions does not exist here.');
      if (before.entryId !== after.entryId) throw badRequest('versions_differ', 'Both versions must belong to the same entry.');
      return { from, to, changes: diffEntryData(before.data as EntryData, after.data as EntryData) };
    });
  }
}

// --- Helpers -------------------------------------------------------------------------------------

/** What the workflow rules need about an entry, and who is acting. */
interface Workflow {
  state: WorkflowState;
  live: boolean;
  requireApproval: boolean;
  actor: WorkflowActor;
}

async function workflowOf(tx: DbTransaction, user: AuthUser, entry: EntryRow): Promise<Workflow> {
  const [space] = await tx.select({ requireApproval: spaces.requireApproval }).from(spaces).where(eq(spaces.id, entry.spaceId));
  return {
    state: workflowState({ status: entry.status as EntryStatus, currentVersionId: entry.currentVersionId, publishedVersionId: entry.publishedVersionId }),
    live: entry.publishedVersionId !== null,
    requireApproval: space?.requireApproval ?? false,
    actor: { role: user.spaces.find((s) => s.id === entry.spaceId)?.role ?? null, agencyStaff: hasStaffAccess(user) },
  };
}

/** Throws the problem the workflow gives for `action`: 403 for who is asking, 409 for the page's state. */
function check(flow: Workflow, action: WorkflowAction): void {
  const refused = refusal(action, flow, flow.actor);
  if (!refused) return;
  throw refused.code === 'insufficient_role' || refused.code === 'approval_required'
    ? forbidden(refused.code, refused.detail)
    : conflict(refused.code, refused.detail);
}

/** Closes the entry's open review request, if it has one, and says who had asked. */
async function closeReview(
  tx: DbTransaction,
  entryId: string,
  decision: ReviewDecision,
  user: AuthUser,
  comment: string | null = null,
): Promise<{ requestedBy: string | null } | null> {
  const [closed] = await tx
    .update(reviewRequests)
    .set({ decision, comment, decidedBy: user.id, decidedAt: sql`now()` })
    .where(and(eq(reviewRequests.entryId, entryId), isNull(reviewRequests.decision)))
    .returning({ requestedBy: reviewRequests.requestedBy });
  return closed ?? null;
}

/** A change to a page in review takes it out of review: it has to be sent again. */
async function leaveReview(tx: DbTransaction, entry: EntryRow, flow: Workflow, user: AuthUser): Promise<void> {
  if (flow.state !== 'in_review') return;
  await tx.update(entries).set({ status: storedStatus('draft', flow.live) }).where(eq(entries.id, entry.id));
  await closeReview(tx, entry.id, 'withdrawn', user);
}

const requesters = alias(profiles, 'requesters');
const deciders = alias(profiles, 'deciders');

/** Review requests with the names of who asked and who decided. */
function reviewsOf(tx: DbTransaction, where: SQL | undefined) {
  return tx
    .select({ request: reviewRequests, requestedByName: requesters.displayName, decidedByName: deciders.displayName })
    .from(reviewRequests)
    .leftJoin(requesters, eq(requesters.userId, reviewRequests.requestedBy))
    .leftJoin(deciders, eq(deciders.userId, reviewRequests.decidedBy))
    .where(where)
    .$dynamic();
}

function toReview({
  request,
  requestedByName,
  decidedByName,
}: {
  request: typeof reviewRequests.$inferSelect;
  requestedByName: string | null;
  decidedByName: string | null;
}): ReviewRequest {
  return {
    id: request.id,
    entryId: request.entryId,
    versionId: request.versionId,
    message: request.message,
    requestedBy: request.requestedBy,
    requestedByName,
    requestedAt: request.requestedAt,
    decision: request.decision as ReviewDecision | null,
    comment: request.comment,
    decidedBy: request.decidedBy,
    decidedByName,
    decidedAt: request.decidedAt,
  };
}

function page(entry: Entry, spaceId: string): NotifiedPage {
  return { spaceId, entryId: entry.id, title: entry.title };
}

/** A stored path as the site shows it: the top-level home page is `/`. */
function sitePathOf(path: string): string {
  return path === `/${HOME_SLUG}` ? '/' : path;
}

/** Inserts a version and points the entry at it (and at the slug its data holds). */
async function saveVersion(
  tx: DbTransaction,
  entry: EntryRow,
  user: AuthUser,
  data: EntryData,
  options: { message: string | null; autosave: boolean; slug: string },
): Promise<void> {
  const [version] = await tx
    .insert(entryVersions)
    .values({ entryId: entry.id, spaceId: entry.spaceId, data, message: options.message, autosave: options.autosave, createdBy: user.id })
    .returning({ id: entryVersions.id });
  await tx.update(entries).set({ currentVersionId: version.id, slug: options.slug }).where(eq(entries.id, entry.id));
}

/** Scheduled actions with the name of who scheduled each, newest first. */
async function readScheduledActions(tx: DbTransaction, where: SQL | undefined, limit: number): Promise<ScheduledAction[]> {
  const rows = await tx
    .select({ action: scheduledActions, createdByName: profiles.displayName })
    .from(scheduledActions)
    .leftJoin(profiles, eq(profiles.userId, scheduledActions.createdBy))
    .where(where)
    .orderBy(desc(scheduledActions.createdAt), desc(scheduledActions.id))
    .limit(limit);
  return rows.map(({ action, createdByName }) => ({
    id: action.id,
    entryId: action.entryId as string,
    action: action.action as ScheduledActionKind,
    runAt: action.runAt,
    status: action.status as ScheduledActionStatus,
    error: action.error,
    createdBy: action.createdBy,
    createdByName,
    createdAt: action.createdAt,
    finishedAt: action.finishedAt,
  }));
}

/** A page that leaves the site's reach (archived, or in the bin) has nothing left to publish or unpublish. */
async function cancelWaitingActions(tx: DbTransaction, entryId: string): Promise<void> {
  await tx
    .update(scheduledActions)
    .set({ status: 'cancelled', finishedAt: sql`now()` })
    .where(and(eq(scheduledActions.entryId, entryId), eq(scheduledActions.status, 'scheduled')));
}

/** Records which files the published version uses (the library's "in use" warning and the image route read it). */
async function recordUsages(tx: DbTransaction, entry: EntryRow, refs: readonly MediaRef[]): Promise<void> {
  await tx.delete(assetUsages).where(eq(assetUsages.entryId, entry.id));
  if (!refs.length) return;
  await tx
    .insert(assetUsages)
    .values(refs.map((ref) => ({ assetId: ref.assetId, entryId: entry.id, spaceId: entry.spaceId, fieldPath: ref.path })))
    .onConflictDoNothing();
}

/**
 * Removes the published copy and its record of files used, and marks the entry as a draft; returns the
 * event to announce after commit.
 */
async function takeOffline(tx: DbTransaction, model: EntryModel, entry: EntryRow, user: AuthUser): Promise<EntryUnpublishedEvent> {
  const [removed] = await tx
    .delete(publishedContent)
    .where(eq(publishedContent.entryId, entry.id))
    .returning({ fullPath: publishedContent.fullPath, cacheTags: publishedContent.cacheTags });
  await tx.delete(assetUsages).where(eq(assetUsages.entryId, entry.id));
  await tx
    .update(entries)
    .set({ status: 'draft', publishedVersionId: null, publishedAt: null })
    .where(eq(entries.id, entry.id));
  const type = contentTypeById(model, entry.contentTypeId);
  const path = removed?.fullPath ?? '';
  return {
    type: 'entry.unpublished',
    spaceId: entry.spaceId,
    environmentId: entry.environmentId,
    entryId: entry.id,
    contentType: type.apiId,
    path,
    cacheTags: removed?.cacheTags ?? cacheTags({ id: entry.id, environmentId: entry.environmentId, contentType: type.apiId }),
    actorId: user.id,
  };
}

async function findEntry(tx: DbTransaction, envId: string, id: string): Promise<EntryRow> {
  const [entry] = await tx
    .select()
    .from(entries)
    .where(and(eq(entries.id, id), eq(entries.environmentId, envId)));
  if (!entry) throw notFound('entry_not_found', 'This page does not exist, or has been deleted.');
  return entry;
}

/** An entry that is not in the bin. */
/** The site's home page: the top-level page with the home slug, at `/` (as the Delivery API reads it). */
function isHomePage(entry: EntryRow, type: { kind: string }): boolean {
  return type.kind === 'page' && entry.folderId === null && entry.slug === HOME_SLUG;
}

async function liveEntry(tx: DbTransaction, envId: string, id: string): Promise<EntryRow> {
  const entry = await findEntry(tx, envId, id);
  if (entry.deletedAt) throw conflict('entry_deleted', 'This is in the bin. Restore it first.');
  return entry;
}

async function folderPath(tx: DbTransaction, envId: string, folderId: string): Promise<string> {
  const [folder] = await tx
    .select({ path: folders.path })
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.environmentId, envId)));
  if (!folder) throw badRequest('folder_not_found', 'That folder does not exist here.');
  return folder.path;
}

async function readEntry(tx: DbTransaction, envId: string, id: string, model?: EntryModel): Promise<Entry> {
  const [row] = await tx
    .select({ ...summaryColumns, publishedPath: publishedContent.fullPath })
    .from(entries)
    .innerJoin(contentTypes, eq(contentTypes.id, entries.contentTypeId))
    .innerJoin(entryVersions, eq(entryVersions.id, entries.currentVersionId))
    .leftJoin(folders, eq(folders.id, entries.folderId))
    .leftJoin(publishedContent, eq(publishedContent.entryId, entries.id))
    .where(and(eq(entries.id, id), eq(entries.environmentId, envId)));
  if (!row) throw notFound('entry_not_found', 'This page does not exist, or has been deleted.');
  return {
    ...toSummary(row, model ?? (await modelOf(tx, row.entry.spaceId, envId))),
    data: row.data as EntryData,
    currentVersionId: row.entry.currentVersionId as string,
    publishedVersionId: row.entry.publishedVersionId,
    publishedPath: row.publishedPath,
  };
}

interface SummaryRow {
  entry: EntryRow;
  contentType: { apiId: string; name: string; kind: string };
  folderPath: string | null;
  title: string;
  data: unknown;
}

function toSummary({ entry, contentType, folderPath: path, title, data }: SummaryRow, model: EntryModel): EntrySummary {
  const { defaultLocale } = model.localeSettings;
  const others = model.locales.locales.filter((locale) => !locale.isDefault).map((locale) => locale.code);
  const fields = contentTypeById(model, entry.contentTypeId)?.fields ?? [];
  return {
    id: entry.id,
    contentType: contentType.apiId,
    contentTypeName: contentType.name,
    kind: contentType.kind as ContentTypeKind,
    folderId: entry.folderId,
    slug: entry.slug,
    path: entryPath(path, entry.slug),
    title,
    missingTranslations: others.length ? localesMissingTranslations(fields, (data ?? {}) as EntryData, others, defaultLocale, model.blockTypes) : [],
    status: entry.status as EntryStatus,
    hasUnpublishedChanges: entry.publishedVersionId !== null && entry.publishedVersionId !== entry.currentVersionId,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    publishedAt: entry.publishedAt,
    deletedAt: entry.deletedAt,
  };
}
