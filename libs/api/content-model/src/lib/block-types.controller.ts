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
  type BlockType,
  createBlockTypeRequestSchema,
  forceQuerySchema,
  updateBlockTypeRequestSchema,
} from '@novan/shared-schemas';
import type { z } from 'zod';
import { ContentModelService } from './content-model.service';

const forcePipe = new ZodValidationPipe(forceQuerySchema);

/** Block types of an environment. Members read them; admins and developers change them. */
@Controller('v1/management/spaces/:spaceId/environments/:env/block-types')
@UseGuards(AuthGuard, SpaceGuard)
export class BlockTypesController {
  constructor(private readonly model: ContentModelService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess, @Param('env') env: string): Promise<BlockType[]> {
    return this.model.listBlockTypes(user, space.id, env);
  }

  @Get(':apiId')
  get(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('apiId') apiId: string,
  ): Promise<BlockType> {
    return this.model.getBlockType(user, space.id, env, apiId);
  }

  @Post()
  @HttpCode(201)
  @RequireRole('admin', 'developer')
  create(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Body(new ZodValidationPipe(createBlockTypeRequestSchema)) body: z.output<typeof createBlockTypeRequestSchema>,
  ): Promise<BlockType> {
    return this.model.createBlockType(user, space.id, env, body);
  }

  /** Answers 409 `entries_invalidated` (with `affectedEntries`) for a change that breaks entries, unless `?force=true`. */
  @Patch(':apiId')
  @RequireRole('admin', 'developer')
  update(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('apiId') apiId: string,
    @Query('force', forcePipe) force: boolean,
    @Body(new ZodValidationPipe(updateBlockTypeRequestSchema)) body: z.output<typeof updateBlockTypeRequestSchema>,
  ): Promise<BlockType> {
    return this.model.updateBlockType(user, space.id, env, apiId, body, force);
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
    return this.model.deleteBlockType(user, space.id, env, apiId, force);
  }
}
