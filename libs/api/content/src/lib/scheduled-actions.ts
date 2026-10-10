import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { type AuthUser, toAuthUser } from '@novan/api-auth';
import { ProblemException } from '@novan/api-common';
import { DbService, entries, environments, members, profiles, releases, roles, scheduledActions } from '@novan/api-db';
import { type Job, type JobContext, JobHandlers, PermanentJobError } from '@novan/api-jobs';
import { and, eq, sql } from 'drizzle-orm';
import { EntriesService } from './entries.service';
import { ReleasesService } from './releases.service';

/** Sent to the `publish` queue by `enqueue_due_scheduled_actions()` (0015_scheduling.sql) when an action comes due. */
export interface ScheduledActionJob extends Job {
  type: 'scheduled-action';
  actionId: string;
  spaceId: string;
}

type ActionRow = typeof scheduledActions.$inferSelect;

/**
 * Carries out scheduled publishing and unpublishing in the worker (docs/build/17-scheduling-releases-webhooks.md). It
 * acts as the person who scheduled it, with their memberships as they are now, through the same `EntriesService` calls
 * as the buttons, so the workflow, RLS, audit log and CDN purge all apply. Whatever the page or the person's role
 * refuses (an incomplete page, a lost role) fails the action with that reason, shown on the page; anything else is
 * retried, and fails the action on the last attempt.
 */
@Injectable()
export class ScheduledActionRunner implements OnModuleInit {
  private readonly logger = new Logger(ScheduledActionRunner.name);

  constructor(
    private readonly db: DbService,
    private readonly jobs: JobHandlers,
    private readonly entries: EntriesService,
    private readonly releases: ReleasesService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('publish', 'scheduled-action', (job, context) => this.run(job as ScheduledActionJob, context));
  }

  async run(job: ScheduledActionJob, context: JobContext): Promise<void> {
    if (typeof job.actionId !== 'string') throw new PermanentJobError('A scheduled-action job needs an actionId');
    const [action] = await this.db.serviceDb.select().from(scheduledActions).where(eq(scheduledActions.id, job.actionId));
    // Gone with its page, or already carried out by an earlier attempt that recorded it.
    if (action?.status !== 'queued') return;
    if (action.releaseId) return this.runRelease(action, action.releaseId, context);
    if (!action.entryId) throw new PermanentJobError(`Scheduled action ${action.id} names neither a page nor a release`);

    const [page] = await this.db.serviceDb
      .select({ env: environments.name, current: entries.currentVersionId, published: entries.publishedVersionId, publishedAt: entries.publishedAt })
      .from(entries)
      .innerJoin(environments, eq(environments.id, entries.environmentId))
      .where(eq(entries.id, action.entryId));
    if (!page) return this.finish(action, 'failed', 'The page no longer exists.');
    // An earlier attempt may have done the work and died before recording it.
    if (context.attempt > 1 && alreadyDone(action, page)) return this.finish(action, 'done');

    const user = action.createdBy ? await this.actingUser(action.createdBy) : null;
    if (!user) return this.finish(action, 'failed', 'The person who scheduled this no longer has an account.');
    try {
      if (action.action === 'publish') await this.entries.publish(user, action.spaceId, page.env, action.entryId);
      else await this.entries.unpublish(user, action.spaceId, page.env, action.entryId);
    } catch (error) {
      if (error instanceof ProblemException && error.getStatus() < 500) {
        return this.finish(action, 'failed', error.toProblem().detail ?? error.message);
      }
      if (context.final) await this.finish(action, 'failed', 'It could not be done. The agency has been told.');
      throw error;
    }
    await this.finish(action, 'done');
    this.logger.log(`Scheduled ${action.action} of entry ${action.entryId} done`);
  }

  /** Publishes a scheduled release in one transaction; a failure marks the release failed, with the reason. */
  private async runRelease(action: ActionRow, releaseId: string, context: JobContext): Promise<void> {
    const [release] = await this.db.serviceDb.select({ status: releases.status }).from(releases).where(eq(releases.id, releaseId));
    // Published by hand, or by an earlier attempt that died before recording it.
    if (release?.status === 'published') return this.finish(action, 'done');
    const user = action.createdBy ? await this.actingUser(action.createdBy) : null;
    const fail = async (reason: string): Promise<void> => {
      await this.finish(action, 'failed', reason);
      await this.db.serviceDb
        .update(releases)
        .set({ status: 'failed', scheduledAt: null, error: reason.slice(0, 2000) })
        .where(and(eq(releases.id, releaseId), eq(releases.status, 'scheduled')));
    };
    if (!user) return fail('The person who scheduled this no longer has an account.');
    try {
      await this.releases.publishScheduled(user, action.spaceId, releaseId);
    } catch (error) {
      if (error instanceof ProblemException && error.getStatus() < 500) {
        const problem = error.toProblem();
        const pages = Object.entries(problem.errors ?? {}).map(([page, messages]) => `${page}: ${messages.join(' ')}`);
        return fail([problem.detail ?? error.message, ...pages].join(' '));
      }
      if (context.final) await fail('It could not be done. The agency has been told.');
      throw error;
    }
    await this.finish(action, 'done');
    this.logger.log(`Scheduled release ${releaseId} published`);
  }

  private async finish(action: ActionRow, status: 'done' | 'failed', error: string | null = null): Promise<void> {
    await this.db.serviceDb
      .update(scheduledActions)
      .set({ status, error: error?.slice(0, 2000) ?? null, finishedAt: sql`now()` })
      .where(and(eq(scheduledActions.id, action.id), eq(scheduledActions.status, 'queued')));
  }

  /**
   * The person as the access token hook (0003_auth_hook.sql) would describe them now. Agency staff needed a second
   * factor to schedule anything outside their own memberships (RLS on `scheduled_actions`), so they act with one.
   */
  private async actingUser(userId: string): Promise<AuthUser | null> {
    const [profile] = await this.db.serviceDb.select({ staff: profiles.isAgencyStaff }).from(profiles).where(eq(profiles.userId, userId));
    if (!profile) return null;
    const spaces = await this.db.serviceDb
      .select({ id: members.spaceId, role: roles.key })
      .from(members)
      .innerJoin(roles, and(eq(roles.id, members.roleId), eq(roles.spaceId, members.spaceId)))
      .where(eq(members.userId, userId));
    return toAuthUser({ sub: userId, role: 'authenticated', aal: profile.staff ? 'aal2' : 'aal1', agency_staff: profile.staff, spaces });
  }
}

/** The page is already as the action would leave it, since the action came due. */
function alreadyDone(action: ActionRow, page: { current: string | null; published: string | null; publishedAt: string | null }): boolean {
  if (action.action === 'unpublish') return page.published === null;
  return page.published !== null && page.published === page.current && page.publishedAt !== null && Date.parse(page.publishedAt) >= Date.parse(action.runAt);
}
