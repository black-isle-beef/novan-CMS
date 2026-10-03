import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
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
import { createFolderRequestSchema, type Folder, updateFolderRequestSchema } from '@novan/shared-schemas';
import { z } from 'zod';
import { AUTHORS, EDITORS } from './content-access';
import { FoldersService } from './folders.service';

const idPipe = new ZodValidationPipe(z.uuid('Expected an id (UUID).'));

/** Folders of an environment. Authors and up add them; renaming, moving and deleting need an editor. */
@Controller('v1/management/spaces/:spaceId/environments/:env/folders')
@UseGuards(AuthGuard, SpaceGuard)
export class FoldersController {
  constructor(private readonly folders: FoldersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess, @Param('env') env: string): Promise<Folder[]> {
    return this.folders.list(user, space.id, env);
  }

  @Post()
  @HttpCode(201)
  @RequireRole(...AUTHORS)
  create(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Body(new ZodValidationPipe(createFolderRequestSchema)) body: z.output<typeof createFolderRequestSchema>,
  ): Promise<Folder> {
    return this.folders.create(user, space.id, env, body);
  }

  /** Renaming or moving changes the address of everything inside, published pages included. */
  @Patch(':id')
  @RequireRole(...EDITORS)
  update(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(updateFolderRequestSchema)) body: z.output<typeof updateFolderRequestSchema>,
  ): Promise<Folder> {
    return this.folders.update(user, space.id, env, id, body);
  }

  /** Answers 409 `folder_not_empty` while it holds folders or live entries. */
  @Delete(':id')
  @HttpCode(204)
  @RequireRole(...EDITORS)
  remove(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('env') env: string,
    @Param('id', idPipe) id: string,
  ): Promise<void> {
    return this.folders.remove(user, space.id, env, id);
  }
}
