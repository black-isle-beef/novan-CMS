import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiResponse, ZodValidationPipe } from '@novan/api-common';
import { AuthGuard, type AuthUser, CurrentSpace, CurrentUser, RequireRole, type SpaceAccess, SpaceGuard } from '@novan/api-auth';
import {
  createRedirectRequestSchema,
  type ImportRedirectsResult,
  importRedirectsRequestSchema,
  importRedirectsResultSchema,
  type NotFoundSummary,
  notFoundQuerySchema,
  notFoundSummarySchema,
  type Redirect,
  redirectSchema,
  type SpaceRole,
  updateRedirectRequestSchema,
} from '@novan/shared-schemas';
import { z } from 'zod';
import { NotFoundService } from './not-found.service';
import { RedirectsService } from './redirects.service';

/** Roles that change redirects, as for publishing. RLS applies the same rule (0012_seo_site.sql). */
export const EDITORS: SpaceRole[] = ['admin', 'developer', 'editor'];

const idPipe = new ZodValidationPipe(z.uuid('Expected an id (UUID).'));

/** A space's redirects. Every member sees them; editors and up add, change, import and delete them. */
@Controller('v1/management/spaces/:spaceId/redirects')
@UseGuards(AuthGuard, SpaceGuard)
export class RedirectsController {
  constructor(private readonly redirects: RedirectsService) {}

  @Get()
  @ApiResponse(z.array(redirectSchema))
  list(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess): Promise<Redirect[]> {
    return this.redirects.list(user, space.id);
  }

  /** 409 `redirect_exists`, `redirect_hides_page` (a published page is there) or `redirect_loop`. */
  @Post()
  @HttpCode(201)
  @ApiResponse(redirectSchema, { status: 201 })
  @RequireRole(...EDITORS)
  create(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Body(new ZodValidationPipe(createRedirectRequestSchema)) body: z.output<typeof createRedirectRequestSchema>,
  ): Promise<Redirect> {
    return this.redirects.create(user, space.id, body);
  }

  /** Redirects read from a CSV file by the admin; those from addresses that already redirect are replaced. */
  @Post('import')
  @HttpCode(200)
  @ApiResponse(importRedirectsResultSchema)
  @RequireRole(...EDITORS)
  import(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Body(new ZodValidationPipe(importRedirectsRequestSchema)) body: z.output<typeof importRedirectsRequestSchema>,
  ): Promise<ImportRedirectsResult> {
    return this.redirects.import(user, space.id, body);
  }

  @Patch(':id')
  @ApiResponse(redirectSchema)
  @RequireRole(...EDITORS)
  update(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(updateRedirectRequestSchema)) body: z.output<typeof updateRedirectRequestSchema>,
  ): Promise<Redirect> {
    return this.redirects.update(user, space.id, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiResponse(null, { status: 204 })
  @RequireRole(...EDITORS)
  remove(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess, @Param('id', idPipe) id: string): Promise<void> {
    return this.redirects.remove(user, space.id, id);
  }
}

/** Addresses visitors found no page at, most visited first, for every member. */
@Controller('v1/management/spaces/:spaceId/not-found')
@UseGuards(AuthGuard, SpaceGuard)
export class NotFoundController {
  constructor(private readonly notFound: NotFoundService) {}

  @Get()
  @ApiResponse(z.array(notFoundSummarySchema))
  list(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Query(new ZodValidationPipe(notFoundQuerySchema)) query: z.output<typeof notFoundQuerySchema>,
  ): Promise<NotFoundSummary[]> {
    return this.notFound.list(user, space.id, query);
  }
}
