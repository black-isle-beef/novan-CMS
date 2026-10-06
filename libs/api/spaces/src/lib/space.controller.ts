import { Body, Controller, Get, HttpCode, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiResponse, ZodValidationPipe } from '@novan/api-common';
import {
  AuthGuard,
  type AuthUser,
  CurrentSpace,
  CurrentUser,
  RequireAgencyStaff,
  RequireRole,
  type SpaceAccess,
  SpaceGuard,
} from '@novan/api-auth';
import {
  type OnboardingResponse,
  onboardingResponseSchema,
  type SpaceSummary,
  spaceSummarySchema,
  updateSpaceRequestSchema,
  type ViewAsRequest,
  viewAsRequestSchema,
} from '@novan/shared-schemas';
import type { z } from 'zod';
import { SpacesService } from './spaces.service';

/** One space: its settings, its onboarding checklist and the agency's "view as" record. */
@Controller('v1/management/spaces/:spaceId')
@UseGuards(AuthGuard, SpaceGuard)
export class SpaceController {
  constructor(private readonly spaces: SpacesService) {}

  /** Renames the space or changes its site address (space admins and agency staff; RLS agrees). */
  @Patch()
  @ApiResponse(spaceSummarySchema)
  @RequireRole('admin')
  update(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Body(new ZodValidationPipe(updateSpaceRequestSchema)) body: z.output<typeof updateSpaceRequestSchema>,
  ): Promise<SpaceSummary> {
    return this.spaces.update(user, space.id, body);
  }

  /** The onboarding checklist, for every member. */
  @Get('onboarding')
  @ApiResponse(onboardingResponseSchema)
  onboarding(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess): Promise<OnboardingResponse> {
    return this.spaces.onboarding(user, space.id);
  }

  /** Hides the checklist for everyone in the space (authors and up). */
  @Post('onboarding/dismiss')
  @HttpCode(200)
  @ApiResponse(onboardingResponseSchema)
  @RequireRole('admin', 'developer', 'editor', 'author')
  dismissOnboarding(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess): Promise<OnboardingResponse> {
    return this.spaces.dismissOnboarding(user, space.id);
  }

  /** Audits agency staff starting or stopping "view as" in the admin. Grants nothing. */
  @Post('view-as')
  @HttpCode(204)
  @ApiResponse(null, { status: 204 })
  @RequireAgencyStaff()
  async viewAs(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Body(new ZodValidationPipe(viewAsRequestSchema)) body: ViewAsRequest,
  ): Promise<void> {
    await this.spaces.viewAs(user, space.id, body.role);
  }
}
