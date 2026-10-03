import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { forbidden, notFound, unauthorized } from '@novan/api-common';
import { z } from 'zod';
import { type AuthenticatedRequest, hasStaffAccess } from './auth-user';
import { REQUIRED_ROLES } from './decorators';

const spaceIdSchema = z.uuid();

/**
 * Resolves `:spaceId` against the caller's `spaces` claim (the same claim RLS uses) and checks
 * `@RequireRole(...)`. Runs after `AuthGuard`. Agency staff at AAL2 pass for every space.
 */
@Injectable()
export class SpaceGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = req.user;
    if (!user) throw unauthorized('missing_token');

    const spaceId = req.params['spaceId'];
    if (!spaceIdSchema.safeParse(spaceId).success) throw notFound('space_not_found', 'No such space.');

    const membership = user.spaces.find((s) => s.id === spaceId);
    const staff = hasStaffAccess(user);
    if (!membership && !staff) throw forbidden('space_forbidden', 'You are not a member of this space.');

    const roles = this.reflector.getAllAndOverride<string[] | undefined>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles?.length && !staff && !roles.includes(membership?.role ?? '')) {
      throw forbidden('insufficient_role', `This needs one of these roles: ${roles.join(', ')}.`);
    }

    req.space = { id: spaceId as string, role: membership?.role ?? null };
    return true;
  }
}
