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
  type Asset,
  type AssetDetail,
  type AssetFolderSummary,
  completeReplaceRequestSchema,
  completeUploadRequestSchema,
  listAssetsQuerySchema,
  type SpaceRole,
  updateAssetRequestSchema,
  uploadUrlRequestSchema,
  type UploadUrlResponse,
} from '@novan/shared-schemas';
import { z } from 'zod';
import { AssetsService } from './assets.service';

const idPipe = new ZodValidationPipe(z.uuid('Expected an id (UUID).'));

/** Roles that upload (`media: upload` in the default roles) and describe their own uploads. */
const UPLOADERS: SpaceRole[] = ['admin', 'developer', 'editor', 'author'];
/** Roles that replace files and use the bin (`media: update, delete`). */
const EDITORS: SpaceRole[] = ['admin', 'developer', 'editor'];

/**
 * The media library of a space. Members read; authors and up upload and describe their own files;
 * editors and up describe any file, replace files and use the bin. RLS applies the same rules.
 */
@Controller('v1/management/spaces/:spaceId/assets')
@UseGuards(AuthGuard, SpaceGuard)
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  /** Live files, newest first, or the bin with `?deleted=true`; filter by `search`, `folder`, `tag`, `kind`, `ids`. */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Query(new ZodValidationPipe(listAssetsQuerySchema)) query: z.output<typeof listAssetsQuerySchema>,
  ): Promise<Asset[]> {
    return this.assets.list(user, space.id, query);
  }

  @Get('folders')
  folders(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess): Promise<AssetFolderSummary[]> {
    return this.assets.folders(user, space.id);
  }

  /** Step 1 of an upload: checks type and size, answers with a signed URL to `PUT` the file to. */
  @Post('upload-url')
  @HttpCode(200)
  @RequireRole(...UPLOADERS)
  uploadUrl(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Body(new ZodValidationPipe(uploadUrlRequestSchema)) body: z.output<typeof uploadUrlRequestSchema>,
  ): Promise<UploadUrlResponse> {
    return this.assets.uploadUrl(user, space.id, body);
  }

  /** Step 2: checks the uploaded file and adds it to the library. */
  @Post('complete')
  @HttpCode(201)
  @RequireRole(...UPLOADERS)
  complete(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Body(new ZodValidationPipe(completeUploadRequestSchema)) body: z.output<typeof completeUploadRequestSchema>,
  ): Promise<AssetDetail> {
    return this.assets.complete(user, space.id, body);
  }

  /** The file's details and the published pages using it. */
  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('id', idPipe) id: string,
  ): Promise<AssetDetail> {
    return this.assets.get(user, space.id, id);
  }

  @Patch(':id')
  @RequireRole(...UPLOADERS)
  update(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(updateAssetRequestSchema)) body: z.output<typeof updateAssetRequestSchema>,
  ): Promise<AssetDetail> {
    return this.assets.update(user, space.id, id, body);
  }

  /** Step 1 of replacing the file: as `upload-url`, for a file of the same kind. */
  @Post(':id/replace-url')
  @HttpCode(200)
  @RequireRole(...EDITORS)
  replaceUrl(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(uploadUrlRequestSchema)) body: z.output<typeof uploadUrlRequestSchema>,
  ): Promise<UploadUrlResponse> {
    return this.assets.uploadUrl(user, space.id, body, id);
  }

  /** Step 2: swaps in the uploaded file, keeping the id. */
  @Post(':id/replace')
  @HttpCode(200)
  @RequireRole(...EDITORS)
  replace(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(completeReplaceRequestSchema)) body: z.output<typeof completeReplaceRequestSchema>,
  ): Promise<AssetDetail> {
    return this.assets.replace(user, space.id, id, body);
  }

  /** Moves the file to the bin (30 days, then purged in package 17). */
  @Delete(':id')
  @HttpCode(204)
  @RequireRole(...EDITORS)
  remove(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('id', idPipe) id: string,
  ): Promise<void> {
    return this.assets.remove(user, space.id, id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequireRole(...EDITORS)
  restore(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('id', idPipe) id: string,
  ): Promise<AssetDetail> {
    return this.assets.restore(user, space.id, id);
  }
}
