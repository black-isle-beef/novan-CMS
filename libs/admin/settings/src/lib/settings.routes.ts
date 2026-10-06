import type { Route } from '@angular/router';
import { requirePermission } from '@novan/admin-spaces';
import { unsavedChangesGuard } from '@novan/admin-shell';
import { requireSettingsAccess, requireSpaceSettingsAccess } from './settings-access';

/**
 * Space settings, inside the signed-in layout. The overview is for everyone in the space; API tokens are for
 * admins and developers, space settings for admins (guards here, links in the shell menu).
 */
export const settingsRoutes: Route[] = [
  {
    path: 'spaces/:spaceId/settings',
    title: 'Settings | Novan CMS',
    canActivate: [requirePermission('space.read')],
    loadComponent: () => import('./settings-page/settings-page').then((m) => m.SettingsPage),
  },
  {
    path: 'spaces/:spaceId/settings/api-tokens',
    title: 'API tokens | Novan CMS',
    canActivate: [requireSettingsAccess],
    loadComponent: () => import('./api-tokens-page/api-tokens-page').then((m) => m.ApiTokensPage),
  },
  {
    path: 'spaces/:spaceId/settings/space',
    title: 'Space settings | Novan CMS',
    canActivate: [requireSpaceSettingsAccess],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./space-settings-page/space-settings-page').then((m) => m.SpaceSettingsPage),
  },
];
