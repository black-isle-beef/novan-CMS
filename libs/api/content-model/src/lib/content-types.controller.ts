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
  type ContentType,
  createContentTypeRequestSchema,
  forceQuerySchema,
  updateContentTypeRequestSchema,
} from '@novan/shared-schemas';
import type { z } from 'zod';
import { ContentModelService } from './content-model.service';

const forcePipe = new ZodValidationPipe(forceQuerySchema);

/** Content types of an environment. Members read them; admins and developers change them. */
@Controller('v1/management/spaces/:spaceId/environments/:env/content-types')
@UseGuards(AuthGuard, SpaceGuard)
export class ContentTypesController {
  constructor(private readonly model: ContentModelService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess, @Param('env') env: string): Promise<ContentType[]> {
    return this.model.listContentTypes(user, space.id, env);
  }

  @Get(':apiId')
  get(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('apiId') apiId: string,
  ): Promise<ContentType> {
    return this.model.getContentType(user, space.id, env, apiId);
  }

  @Post()
  @HttpCode(201)
  @RequireRole('admin', 'developer')
  create(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Body(new ZodValidationPipe(createContentTypeRequestSchema)) body: z.output<typeof createContentTypeRequestSchema>,
  ): Promise<ContentType> {
    return this.model.createContentType(user, space.id, env, body);
  }

  /** Answers 409 `entries_invalidated` (with `affectedEntries`) for a field change that breaks entries, unless `?force=true`. */
  @Patch(':apiId')
  @RequireRole('admin', 'developer')
  update(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('apiId') apiId: string,
    @Query('force', forcePipe) force: boolean,
    @Body(new ZodValidationPipe(updateContentTypeRequestSchema)) body: z.output<typeof updateContentTypeRequestSchema>,
  ): Promise<ContentType> {
    return this.model.updateContentType(user, space.id, env, apiId, body, force);
  }

  @Delete(':apiId')
  @HttpCode(204)
  @RequireRole('admin', 'developer')
  remove(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('apiId') apiId: string,
    @Query('force', forcePipe) force: boolean,
  ): Promise<void> {
    return this.model.deleteContentType(user, space.id, env, apiId, force);
  }
}
