import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { SpaceRole } from '@novan/shared-schemas';
import type { AuthenticatedRequest, AuthUser, SpaceAccess } from './auth-user';

export const REQUIRED_ROLES = 'novan:requiredRoles';
export const ALLOW_AAL1 = 'novan:allowAal1';
export const REQUIRE_AGENCY_STAFF = 'novan:requireAgencyStaff';

/** Space roles allowed on a route guarded by `SpaceGuard`. Agency staff (AAL2) always pass. */
export const RequireRole = (...roles: SpaceRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ROLES, roles);

/**
 * Lets agency staff reach the route before completing their second factor. Every other route
 * answers 403 `mfa_required` for agency staff at AAL1.
 */
export const AllowAal1 = (): MethodDecorator & ClassDecorator => SetMetadata(ALLOW_AAL1, true);

/** Only agency staff (at AAL2) may call the route. */
export const RequireAgencyStaff = (): MethodDecorator & ClassDecorator => SetMetadata(REQUIRE_AGENCY_STAFF, true);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user as AuthUser,
);

export const CurrentSpace = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): SpaceAccess =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().space as SpaceAccess,
);
