import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiResponse, ZodValidationPipe } from '@novan/api-common';
import {
  AuthGuard,
  type AuthUser,
  CurrentSpace,
  CurrentUser,
  RequireRole,
  type SpaceAccess,
  SpaceGuard,
} from '@novan/api-auth';
import {
  autosaveEntryRequestSchema,
  createEntryRequestSchema,
  type Entry,
  type EntrySummary,
  type EntryVersion,
  type EntryWorkflow,
  entryWorkflowSchema,
  listEntriesQuerySchema,
  type MachineTranslation,
  machineTranslationSchema,
  moveEntryRequestSchema,
  translateEntryRequestSchema,
  type PendingReview,
  requestChangesRequestSchema,
  type ScheduledAction,
  scheduledActionSchema,
  scheduleActionRequestSchema,
  updateEntryRequestSchema,
  workflowMessageRequestSchema,
} from '@novan/shared-schemas';
import { z } from 'zod';
import { AUTHORS, EDITORS } from './content-access';
import { EntriesService } from './entries.service';

const idPipe = new ZodValidationPipe(z.uuid('Expected an id (UUID).'));

/**
 * Entries (pages and other content) of an environment. Members read; authors and up save drafts;
 * editors and up publish, unpublish and use the bin. RLS applies the same rules.
 */
@Controller('v1/management/spaces/:spaceId/environments/:env/entries')
@UseGuards(AuthGuard, SpaceGuard)
export class EntriesController {
  constructor(private readonly entries: EntriesService) {}

  /** Live entries, or the bin with `?deleted=true`; filter by `contentType`, `folderId` (or `root`) and `search`. */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Query(new ZodValidationPipe(listEntriesQuerySchema)) query: z.output<typeof listEntriesQuerySchema>,
  ): Promise<EntrySummary[]> {
    return this.entries.list(user, space.id, env, query);
  }

  @Post()
  @HttpCode(201)
  @RequireRole(...AUTHORS)
  create(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Body(new ZodValidationPipe(createEntryRequestSchema)) body: z.output<typeof createEntryRequestSchema>,
  ): Promise<Entry> {
    return this.entries.create(user, space.id, env, body);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
  ): Promise<Entry> {
    return this.entries.get(user, space.id, env, id);
  }

  /** Saves a new version (answers 400 `entry_invalid` with field errors for malformed data). */
  @Patch(':id')
  @RequireRole(...AUTHORS)
  update(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(updateEntryRequestSchema)) body: z.output<typeof updateEntryRequestSchema>,
  ): Promise<Entry> {
    return this.entries.update(user, space.id, env, id, body);
  }

  @Post(':id/autosave')
  @HttpCode(200)
  @RequireRole(...AUTHORS)
  autosave(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(autosaveEntryRequestSchema)) body: z.output<typeof autosaveEntryRequestSchema>,
  ): Promise<Entry> {
    return this.entries.autosave(user, space.id, env, id, body);
  }

  /**
   * Publishes the current version, with an optional message saved on it (400 `entry_invalid` when it is incomplete;
   * 403 `approval_required` when the space needs a review first). The workflow decides who may (workflow.ts).
   */
  @Post(':id/publish')
  @HttpCode(200)
  @RequireRole(...EDITORS)
  publish(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(workflowMessageRequestSchema)) body: z.output<typeof workflowMessageRequestSchema>,
  ): Promise<Entry> {
    return this.entries.publish(user, space.id, env, id, body.message ?? null);
  }

  /**
   * Fills a locale's empty translations with a machine translation, saved as a draft version marked as
   * machine-translated (docs/build/16-localisation.md). Answers 501 `translation_unavailable` when no translator is
   * set up, and 409 `entry_changed` when the page changed while it was being translated.
   */
  @Post(':id/translate')
  @HttpCode(200)
  @ApiResponse(machineTranslationSchema)
  @RequireRole(...AUTHORS)
  translate(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(translateEntryRequestSchema)) body: z.output<typeof translateEntryRequestSchema>,
  ): Promise<MachineTranslation> {
    return this.entries.translate(user, space.id, env, id, body);
  }

  /** The page's place in the workflow and the actions the caller may take. */
  @Get(':id/workflow')
  @ApiResponse(entryWorkflowSchema)
  workflow(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
  ): Promise<EntryWorkflow> {
    return this.entries.workflow(user, space.id, env, id);
  }

  /** The page's scheduled publishing and unpublishing, newest first. */
  @Get(':id/schedule')
  @ApiResponse(z.array(scheduledActionSchema))
  scheduledActions(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
  ): Promise<ScheduledAction[]> {
    return this.entries.scheduledActions(user, space.id, env, id);
  }

  /**
   * Publishes or unpublishes the page at `runAt` (400 `run_at_past`; 409 `already_scheduled` while one of the same kind
   * waits; 403 `approval_required` for publishing in a space that needs approval, unless a space admin).
   */
  @Post(':id/schedule')
  @HttpCode(201)
  @ApiResponse(scheduledActionSchema)
  @RequireRole(...EDITORS)
  schedule(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(scheduleActionRequestSchema)) body: z.output<typeof scheduleActionRequestSchema>,
  ): Promise<ScheduledAction> {
    return this.entries.schedule(user, space.id, env, id, body);
  }

  /** Cancels a scheduled action that is still waiting (409 `not_waiting` once it has run). */
  @Post(':id/schedule/:actionId/cancel')
  @HttpCode(200)
  @ApiResponse(scheduledActionSchema)
  @RequireRole(...EDITORS)
  cancelScheduled(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
    @Param('actionId', idPipe) actionId: string,
  ): Promise<ScheduledAction> {
    return this.entries.cancelScheduled(user, space.id, env, id, actionId);
  }

  /** Sends the page for review (spaces that need approval). */
  @Post(':id/submit')
  @HttpCode(200)
  @RequireRole(...AUTHORS)
  submit(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(workflowMessageRequestSchema)) body: z.output<typeof workflowMessageRequestSchema>,
  ): Promise<Entry> {
    return this.entries.submit(user, space.id, env, id, body.message ?? null);
  }

  /** Approves and publishes a page waiting for review (space admins and agency staff). */
  @Post(':id/approve')
  @HttpCode(200)
  @RequireRole(...EDITORS)
  approve(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(workflowMessageRequestSchema)) body: z.output<typeof workflowMessageRequestSchema>,
  ): Promise<Entry> {
    return this.entries.approve(user, space.id, env, id, body.message ?? null);
  }

  /** Sends a page in review back with a comment (space admins and agency staff). */
  @Post(':id/request-changes')
  @HttpCode(200)
  @RequireRole(...EDITORS)
  requestChanges(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(requestChangesRequestSchema)) body: z.output<typeof requestChangesRequestSchema>,
  ): Promise<Entry> {
    return this.entries.requestChanges(user, space.id, env, id, body.comment);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequireRole(...EDITORS)
  archive(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
  ): Promise<Entry> {
    return this.entries.archive(user, space.id, env, id);
  }

  @Post(':id/unarchive')
  @HttpCode(200)
  @RequireRole(...EDITORS)
  unarchive(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
  ): Promise<Entry> {
    return this.entries.unarchive(user, space.id, env, id);
  }

  /** Pages and entries that point at this one, for the unpublish dialog. */
  @Get(':id/references')
  references(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
  ): Promise<EntrySummary[]> {
    return this.entries.references(user, space.id, env, id);
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @RequireRole(...EDITORS)
  unpublish(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
  ): Promise<Entry> {
    return this.entries.unpublish(user, space.id, env, id);
  }

  /** Takes the entry out of the bin. */
  @Post(':id/restore')
  @HttpCode(200)
  @RequireRole(...EDITORS)
  restore(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
  ): Promise<Entry> {
    return this.entries.restore(user, space.id, env, id);
  }

  /** Makes an earlier version the current one. */
  @Post(':id/restore/:versionId')
  @HttpCode(200)
  @RequireRole(...AUTHORS)
  restoreVersion(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
    @Param('versionId', idPipe) versionId: string,
  ): Promise<Entry> {
    return this.entries.restoreVersion(user, space.id, env, id, versionId);
  }

  @Post(':id/move')
  @HttpCode(200)
  @RequireRole(...AUTHORS)
  move(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(moveEntryRequestSchema)) body: z.output<typeof moveEntryRequestSchema>,
  ): Promise<Entry> {
    return this.entries.move(user, space, env, id, body);
  }

  /** Moves the entry to the bin (30 days, then purged in package 17). */
  @Delete(':id')
  @HttpCode(204)
  @RequireRole(...EDITORS)
  remove(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
  ): Promise<void> {
    return this.entries.remove(user, space.id, env, id);
  }

  @Get(':id/versions')
  versions(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
  ): Promise<EntryVersion[]> {
    return this.entries.versions(user, space.id, env, id);
  }
}

/** Pages waiting for review in an environment: the reviewer inbox on the dashboard. Every member may look. */
@Controller('v1/management/spaces/:spaceId/environments/:env/reviews')
@UseGuards(AuthGuard, SpaceGuard)
export class ReviewsController {
  constructor(private readonly entries: EntriesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess, @Param('env') env: string): Promise<PendingReview[]> {
    return this.entries.reviews(user, space.id, env);
  }
}
