import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthUser, CurrentSpace, CurrentUser, RequireRole, type SpaceAccess, SpaceGuard } from '@novan/api-auth';
import { ApiResponse, ZodValidationPipe } from '@novan/api-common';
import {
  type ApiToken,
  apiTokenSchema,
  createApiTokenRequestSchema,
  type CreatedApiToken,
  createdApiTokenSchema,
} from '@novan/shared-schemas';
import { z } from 'zod';
import { ApiTokensService } from './api-tokens.service';

const idPipe = new ZodValidationPipe(z.uuid('Expected an id (UUID).'));

/** Delivery and preview tokens of a space. Admins and developers only; RLS applies the same rule. */
@Controller('v1/management/spaces/:spaceId/api-tokens')
@UseGuards(AuthGuard, SpaceGuard)
@RequireRole('admin', 'developer')
export class ApiTokensController {
  constructor(private readonly tokens: ApiTokensService) {}

  /** Newest first, revoked ones included. */
  @Get()
  @ApiResponse(z.array(apiTokenSchema))
  list(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess): Promise<ApiToken[]> {
    return this.tokens.list(user, space.id);
  }

  /** Creates a token; the response is the only time its secret (`token`) is sent. */
  @Post()
  @HttpCode(201)
  @ApiResponse(createdApiTokenSchema, { status: 201 })
  create(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Body(new ZodValidationPipe(createApiTokenRequestSchema)) body: z.output<typeof createApiTokenRequestSchema>,
  ): Promise<CreatedApiToken> {
    return this.tokens.create(user, space.id, body);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @ApiResponse(apiTokenSchema)
  revoke(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess, @Param('id', idPipe) id: string): Promise<ApiToken> {
    return this.tokens.revoke(user, space.id, id);
  }
}
