import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { AuthService } from '@novan/admin-auth';
import { canModel } from '@novan/admin-spaces';

/**
 * Settings are for space admins, developers and agency staff: the same people who change the content
 * model, and the roles the API and RLS allow to manage API tokens (0008_api_tokens.sql). Everyone else is
 * sent to the space's home page; the menu hides the link too.
 */
export const requireSettingsAccess: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const spaceId = route.paramMap.get('spaceId') ?? '';
  const role = auth.claims()?.spaces?.find((space) => space.id === spaceId)?.role;
  return canModel(role, auth.agencyStaff()) || inject(Router).createUrlTree(['/spaces', spaceId]);
};
