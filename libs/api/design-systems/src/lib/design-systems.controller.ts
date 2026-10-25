import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthUser, CurrentSpace, CurrentUser, RequireRole, type SpaceAccess, SpaceGuard } from '@novan/api-auth';
import { ApiResponse, ZodValidationPipe } from '@novan/api-common';
import {
  createDesignSystemRequestSchema,
  createDesignSystemVersionRequestSchema,
  createDesignSystemVersionResponseSchema,
  type CreateDesignSystemVersionResponse,
  type DesignSystem,
  type DesignSystemClasses,
  designSystemClassesQuerySchema,
  designSystemClassesSchema,
  designSystemSchema,
  type DesignSystemVersion,
  designSystemVersionSchema,
  putSiteDesignSystemsRequestSchema,
  type SiteDesignSystem,
  siteDesignSystemSchema,
  type SpaceRole,
} from '@novan/shared-schemas';
import { z } from 'zod';
import { DesignSystemsService } from './design-systems.service';
import { UploadRateLimitGuard } from './upload-rate-limit.guard';

const idPipe = new ZodValidationPipe(z.uuid('Expected an id (UUID).'));

/** Roles that upload, attach and deprecate design systems; every member reads them. */
const MANAGERS: SpaceRole[] = ['admin', 'developer'];

/**
 * A space's design systems and their versions (docs/build/24-design-systems.md). Members read them and their class
 * index (the editor's autocomplete); admins and developers upload versions and deprecate them. RLS applies the same.
 */
@Controller('v1/management/spaces/:spaceId/design-systems')
@UseGuards(AuthGuard, SpaceGuard)
export class DesignSystemsController {
  constructor(private readonly designSystems: DesignSystemsService) {}

  @Get()
  @ApiResponse(z.array(designSystemSchema))
  list(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess): Promise<DesignSystem[]> {
    return this.designSystems.list(user, space.id);
  }

  @Post()
  @HttpCode(201)
  @ApiResponse(designSystemSchema, { status: 201 })
  @RequireRole(...MANAGERS)
  create(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Body(new ZodValidationPipe(createDesignSystemRequestSchema)) body: z.output<typeof createDesignSystemRequestSchema>,
  ): Promise<DesignSystem> {
    return this.designSystems.create(user, space.id, body);
  }

  /** Step 1: a stylesheet to upload (answers with a signed URL), or an https address the API fetches. */
  @Post(':id/versions')
  @HttpCode(201)
  @ApiResponse(createDesignSystemVersionResponseSchema, { status: 201 })
  @RequireRole(...MANAGERS)
  @UseGuards(UploadRateLimitGuard)
  createVersion(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(createDesignSystemVersionRequestSchema)) body: z.output<typeof createDesignSystemVersionRequestSchema>,
  ): Promise<CreateDesignSystemVersionResponse> {
    return this.designSystems.createVersion(user, space.id, id, body);
  }

  /** Step 2: the stylesheet is uploaded; it is checked in the background (poll the version for its status). */
  @Post(':id/versions/:versionId/complete')
  @HttpCode(200)
  @ApiResponse(designSystemVersionSchema)
  @RequireRole(...MANAGERS)
  complete(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('id', idPipe) id: string,
    @Param('versionId', idPipe) versionId: string,
  ): Promise<DesignSystemVersion> {
    return this.designSystems.complete(user, space.id, id, versionId);
  }

  @Get(':id/versions/:versionId')
  @ApiResponse(designSystemVersionSchema)
  version(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('id', idPipe) id: string,
    @Param('versionId', idPipe) versionId: string,
  ): Promise<DesignSystemVersion> {
    return this.designSystems.version(user, space.id, id, versionId);
  }

  /** The version's classes starting with `q` (shortest first), optionally in one `group` (empty: no group). */
  @Get(':id/versions/:versionId/classes')
  @ApiResponse(designSystemClassesSchema)
  classes(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('id', idPipe) id: string,
    @Param('versionId', idPipe) versionId: string,
    @Query(new ZodValidationPipe(designSystemClassesQuerySchema)) query: z.output<typeof designSystemClassesQuerySchema>,
  ): Promise<DesignSystemClasses> {
    return this.designSystems.classes(user, space.id, id, versionId, query);
  }

  @Post(':id/versions/:versionId/deprecate')
  @HttpCode(200)
  @ApiResponse(designSystemVersionSchema)
  @RequireRole(...MANAGERS)
  deprecate(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('id', idPipe) id: string,
    @Param('versionId', idPipe) versionId: string,
  ): Promise<DesignSystemVersion> {
    return this.designSystems.deprecate(user, space.id, id, versionId);
  }
}

/** The design systems the space's site loads, in order (the main environment). */
@Controller('v1/management/spaces/:spaceId/site/design-systems')
@UseGuards(AuthGuard, SpaceGuard)
export class SiteDesignSystemsController {
  constructor(private readonly designSystems: DesignSystemsService) {}

  @Get()
  @ApiResponse(z.array(siteDesignSystemSchema))
  list(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess): Promise<SiteDesignSystem[]> {
    return this.designSystems.site(user, space.id);
  }

  /** Replaces the list: these versions, loaded in this order; any others are detached. */
  @Put()
  @ApiResponse(z.array(siteDesignSystemSchema))
  @RequireRole(...MANAGERS)
  put(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Body(new ZodValidationPipe(putSiteDesignSystemsRequestSchema)) body: z.output<typeof putSiteDesignSystemsRequestSchema>,
  ): Promise<SiteDesignSystem[]> {
    return this.designSystems.putSite(user, space.id, body);
  }
}
