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
import {
  type AddMemberRequest,
  addMemberRequestSchema,
  type InviteRequest,
  inviteRequestSchema,
  type Member,
  type UpdateMemberRequest,
  updateMemberRequestSchema,
} from '@novan/shared-schemas';
import { z } from 'zod';
import { MembersService } from './members.service';

const userIdPipe = new ZodValidationPipe(z.uuid());

@Controller('v1/management/spaces/:spaceId')
@UseGuards(AuthGuard, SpaceGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get('members')
  list(@CurrentUser() user: AuthUser, @CurrentSpace() space: SpaceAccess): Promise<Member[]> {
    return this.members.list(user, space.id);
  }

  @Post('members')
  @HttpCode(201)
  @RequireRole('admin')
  add(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Body(new ZodValidationPipe(addMemberRequestSchema)) body: AddMemberRequest,
  ): Promise<Member> {
    return this.members.add(user, space.id, body.userId, body.role);
  }

  @Patch('members/:userId')
  @RequireRole('admin')
  update(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('userId', userIdPipe) userId: string,
    @Body(new ZodValidationPipe(updateMemberRequestSchema)) body: UpdateMemberRequest,
  ): Promise<Member> {
    return this.members.updateRole(user, space.id, userId, body.role);
  }

  @Delete('members/:userId')
  @HttpCode(204)
  @RequireRole('admin')
  remove(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Param('userId', userIdPipe) userId: string,
  ): Promise<void> {
    return this.members.remove(user, space.id, userId);
  }

  @Post('invites')
  @HttpCode(201)
  @RequireRole('admin')
  invite(
    @CurrentUser() user: AuthUser,
    @CurrentSpace() space: SpaceAccess,
    @Body(new ZodValidationPipe(inviteRequestSchema)) body: InviteRequest,
  ): Promise<Member> {
    return this.members.invite(user, space.id, body);
  }
}
