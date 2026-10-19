import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { AuthService, ViewAs } from '@novan/admin-auth';
import { requirePermission, spaceAccess } from '@novan/admin-spaces';

/**
 * Schema screens are for space admins, developers and agency staff (not while viewing as a client role).
 * Everyone else is sent to the space's dashboard; the menu hides the link too, and the API refuses their writes.
 */
export const requireSchemaAccess = requirePermission('schema.write');

/**
 * Setting up or restoring a schema from GitHub is for agency staff only (not while viewing as a role): the API's
 * GitHub token reads every agency repo. Everyone else is sent to the Schema page.
 */
export const requireSchemaFromGithub: CanActivateFn = (route) => {
  const spaceId = route.paramMap.get('spaceId') ?? '';
  return spaceAccess(spaceId, inject(AuthService), inject(ViewAs)).agencyStaff || inject(Router).createUrlTree(['/spaces', spaceId, 'schema']);
};
