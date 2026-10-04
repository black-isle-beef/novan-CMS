import type { Route } from '@angular/router';
import { requireSettingsAccess } from './settings-access';

/** Space settings, inside the signed-in layout. Admins and developers only (guard here, link in the shell). */
export const settingsRoutes: Route[] = [
  { path: 'spaces/:spaceId/settings', pathMatch: 'full', redirectTo: 'spaces/:spaceId/settings/api-tokens' },
  {
    path: 'spaces/:spaceId/settings/api-tokens',
    title: 'API tokens | Novan CMS',
    canActivate: [requireSettingsAccess],
    loadComponent: () => import('./api-tokens-page/api-tokens-page').then((m) => m.ApiTokensPage),
  },
];
