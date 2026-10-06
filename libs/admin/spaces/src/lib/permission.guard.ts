import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { AuthService, ViewAs } from '@novan/admin-auth';
import { hasPermission, type Permission, type SpaceAccess } from './permissions';

/**
 * The caller's access to a space from their token's claims (display only: the API verifies), or the viewed
 * role while agency staff view the space as one.
 */
export function spaceAccess(spaceId: string, auth: Pick<AuthService, 'claims' | 'agencyStaff'>, viewAs: ViewAs): SpaceAccess {
  const viewed = viewAs.roleIn(spaceId);
  if (viewed) return { role: viewed, agencyStaff: false };
  const role = auth.claims()?.spaces?.find((space) => space.id === spaceId)?.role ?? null;
  return { role, agencyStaff: auth.agencyStaff() };
}

/**
 * Lets the route open when the caller has `permission` in the route's `:spaceId`, mirroring the shell menu.
 * Everyone else goes to the space's dashboard. The API remains the real enforcement.
 */
export function requirePermission(permission: Permission): CanActivateFn {
  return (route) => {
    const spaceId = route.paramMap.get('spaceId') ?? '';
    const access = spaceAccess(spaceId, inject(AuthService), inject(ViewAs));
    return hasPermission(permission, access) || inject(Router).createUrlTree(['/spaces', spaceId]);
  };
}
