import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiResponse, ZodValidationPipe } from '@novan/api-common';
import { AuthGuard, type AuthUser, CurrentSpace, CurrentUser, RequireRole, type SpaceAccess, SpaceGuard } from '@novan/api-auth';
import {
  createLocaleRequestSchema,
  localeCodeSchema,
  localePrefixesRequestSchema,
  type ManagedLocales,
  managedLocalesSchema,
  updateLocaleRequestSchema,
} from '@novan/shared-schemas';
import type { z } from 'zod';
import { LocalesService } from './locales.service';

const codePipe = new ZodValidationPipe(localeCodeSchema);

/**
 * The space's locales (docs/build/16-localisation.md). Every member reads them; space admins and developers add,
 * change and remove them. Each answer is the space's locales after the change.
 */
@Controller('v1/management/spaces/:spaceId/locales')
@UseGuards(AuthGuard, SpaceGuard)
export class LocalesController {
  constructor(private readonly locales: LocalesService) {}

  @Get()
  @ApiResponse(managedLocalesSchema)
  list(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess): Promise<ManagedLocales> {
    return this.locales.list(user, space.id);
  }

  /** Answers 409 `locale_exists`, `prefix_taken` or `too_many_locales`, and 400 `fallback_not_found`. */
  @Post()
  @ApiResponse(managedLocalesSchema, { status: 201 })
  @RequireRole('admin', 'developer')
  create(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Body(new ZodValidationPipe(createLocaleRequestSchema)) body: z.output<typeof createLocaleRequestSchema>,
  ): Promise<ManagedLocales> {
    return this.locales.create(user, space.id, body);
  }

  /** Whether the site serves other locales under their prefix, e.g. `/fr/about` (space admins). */
  @Put('prefixes')
  @ApiResponse(managedLocalesSchema)
  @RequireRole('admin')
  setPrefixes(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Body(new ZodValidationPipe(localePrefixesRequestSchema)) body: z.output<typeof localePrefixesRequestSchema>,
  ): Promise<ManagedLocales> {
    return this.locales.setPrefixes(user, space.id, body.prefixes);
  }

  /** Answers 400 `fallback_circle` for a fallback that would lead back to the locale. */
  @Patch(':code')
  @ApiResponse(managedLocalesSchema)
  @RequireRole('admin', 'developer')
  update(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('code', codePipe) code: string,
    @Body(new ZodValidationPipe(updateLocaleRequestSchema)) body: z.output<typeof updateLocaleRequestSchema>,
  ): Promise<ManagedLocales> {
    return this.locales.update(user, space.id, code, body);
  }

  /** Answers 409 `default_locale` for the default locale. */
  @Delete(':code')
  @ApiResponse(managedLocalesSchema)
  @RequireRole('admin', 'developer')
  remove(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess, @Param('code', codePipe) code: string): Promise<ManagedLocales> {
    return this.locales.remove(user, space.id, code);
  }
}
