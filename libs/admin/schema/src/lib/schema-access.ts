import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { AuthService } from '@novan/admin-auth';
import { canModel } from '@novan/admin-spaces';

/**
 * Schema screens are for space admins, developers and agency staff. Everyone else (client roles) is
 * sent to the space's home page; the menu hides the link too, and the API refuses their writes.
 */
export const requireSchemaAccess: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const spaceId = route.paramMap.get('spaceId') ?? '';
  const role = auth.claims()?.spaces?.find((space) => space.id === spaceId)?.role;
  return canModel(role, auth.agencyStaff()) || inject(Router).createUrlTree(['/spaces', spaceId]);
};
