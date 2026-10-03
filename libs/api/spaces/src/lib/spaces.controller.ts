import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ZodValidationPipe } from '@novan/api-common';
import { AuthGuard, type AuthUser, CurrentUser, RequireAgencyStaff } from '@novan/api-auth';
import { type CreateSpaceRequest, createSpaceRequestSchema, type SpaceSummary } from '@novan/shared-schemas';
import { SpacesService } from './spaces.service';

@Controller('v1/management/spaces')
@UseGuards(AuthGuard)
export class SpacesController {
  constructor(private readonly spaces: SpacesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<SpaceSummary[]> {
    return this.spaces.list(user);
  }

  @Post()
  @HttpCode(201)
  @RequireAgencyStaff()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSpaceRequestSchema)) body: CreateSpaceRequest,
  ): Promise<SpaceSummary> {
    return this.spaces.create(user, body);
  }
}
