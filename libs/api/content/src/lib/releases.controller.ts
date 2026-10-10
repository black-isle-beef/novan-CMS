import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiResponse, ZodValidationPipe } from '@novan/api-common';
import { AuthGuard, type AuthUser, CurrentSpace, CurrentUser, RequireRole, type SpaceAccess, SpaceGuard } from '@novan/api-auth';
import {
  createReleaseRequestSchema,
  putReleaseItemRequestSchema,
  type Release,
  type ReleaseDetail,
  releaseDetailSchema,
  releaseSchema,
  scheduleReleaseRequestSchema,
  updateReleaseRequestSchema,
} from '@novan/shared-schemas';
import { z } from 'zod';
import { EDITORS } from './content-access';
import { ReleasesService } from './releases.service';

const idPipe = new ZodValidationPipe(z.uuid('Expected an id (UUID).'));

/**
 * Releases of an environment (docs/build/17-scheduling-releases-webhooks.md): pages published together, now or at a set
 * time. Members read; editors and up change them and publish them (space admins only, where the space needs approval).
 */
@Controller('v1/management/spaces/:spaceId/environments/:env/releases')
@UseGuards(AuthGuard, SpaceGuard)
export class ReleasesController {
  constructor(private readonly releases: ReleasesService) {}

  @Get()
  @ApiResponse(z.array(releaseSchema))
  list(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess, @Param('env') env: string): Promise<Release[]> {
    return this.releases.list(user, space.id, env);
  }

  @Post()
  @HttpCode(201)
  @ApiResponse(releaseDetailSchema)
  @RequireRole(...EDITORS)
  create(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Body(new ZodValidationPipe(createReleaseRequestSchema)) body: z.output<typeof createReleaseRequestSchema>,
  ): Promise<ReleaseDetail> {
    return this.releases.create(user, space.id, env, body);
  }

  /** The release and its pages, each at the version it publishes. */
  @Get(':id')
  @ApiResponse(releaseDetailSchema)
  get(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess, @Param('env') env: string, @Param('id', idPipe) id: string): Promise<ReleaseDetail> {
    return this.releases.get(user, space.id, env, id);
  }

  @Patch(':id')
  @ApiResponse(releaseDetailSchema)
  @RequireRole(...EDITORS)
  update(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(updateReleaseRequestSchema)) body: z.output<typeof updateReleaseRequestSchema>,
  ): Promise<ReleaseDetail> {
    return this.releases.update(user, space.id, env, id, body);
  }

  /** Deletes a release that has not been published (409 `release_published`). */
  @Delete(':id')
  @HttpCode(204)
  @RequireRole(...EDITORS)
  remove(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess, @Param('env') env: string, @Param('id', idPipe) id: string): Promise<void> {
    return this.releases.remove(user, space.id, env, id);
  }

  /** Adds the page, or changes the version the release publishes (the page's current version by default). */
  @Put(':id/items/:entryId')
  @ApiResponse(releaseDetailSchema)
  @RequireRole(...EDITORS)
  putItem(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
    @Param('entryId', idPipe) entryId: string,
    @Body(new ZodValidationPipe(putReleaseItemRequestSchema)) body: z.output<typeof putReleaseItemRequestSchema>,
  ): Promise<ReleaseDetail> {
    return this.releases.putItem(user, space.id, env, id, entryId, body);
  }

  @Delete(':id/items/:entryId')
  @ApiResponse(releaseDetailSchema)
  @RequireRole(...EDITORS)
  removeItem(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
    @Param('entryId', idPipe) entryId: string,
  ): Promise<ReleaseDetail> {
    return this.releases.removeItem(user, space.id, env, id, entryId);
  }

  /**
   * Publishes every page now, in one transaction (400 `release_invalid` with each page's problems, and nothing
   * published; 400 `release_empty`).
   */
  @Post(':id/publish')
  @HttpCode(200)
  @ApiResponse(releaseDetailSchema)
  @RequireRole(...EDITORS)
  publish(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess, @Param('env') env: string, @Param('id', idPipe) id: string): Promise<ReleaseDetail> {
    return this.releases.publish(user, space.id, env, id);
  }

  /** Publishes the release at `runAt` (400 `run_at_past`, 409 `already_scheduled`). */
  @Post(':id/schedule')
  @HttpCode(200)
  @ApiResponse(releaseDetailSchema)
  @RequireRole(...EDITORS)
  schedule(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(scheduleReleaseRequestSchema)) body: z.output<typeof scheduleReleaseRequestSchema>,
  ): Promise<ReleaseDetail> {
    return this.releases.schedule(user, space.id, env, id, body);
  }

  @Post(':id/schedule/cancel')
  @HttpCode(200)
  @ApiResponse(releaseDetailSchema)
  @RequireRole(...EDITORS)
  cancelSchedule(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
  ): Promise<ReleaseDetail> {
    return this.releases.cancelSchedule(user, space.id, env, id);
  }
}
