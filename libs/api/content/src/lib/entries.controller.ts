import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ZodValidationPipe } from '@novan/api-common';
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
  listEntriesQuerySchema,
  moveEntryRequestSchema,
  updateEntryRequestSchema,
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

  /** Publishes the current version (answers 400 `entry_invalid` when it is incomplete). */
  @Post(':id/publish')
  @HttpCode(200)
  @RequireRole(...EDITORS)
  publish(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
  ): Promise<Entry> {
    return this.entries.publish(user, space.id, env, id);
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
