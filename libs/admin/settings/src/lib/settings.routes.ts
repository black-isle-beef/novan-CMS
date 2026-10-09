import type { Route } from '@angular/router';
import { requirePermission } from '@novan/admin-spaces';
import { unsavedChangesGuard } from '@novan/admin-shell';
import { requireSettingsAccess, requireSpaceSettingsAccess } from './settings-access';

/**
 * Space settings, inside the signed-in layout. The overview, site settings, navigation, redirects and missing pages
 * are for everyone in the space (roles decide what they can change); API tokens are for admins and developers, space
 * settings for admins (guards here, links in the shell menu).
 */
export const settingsRoutes: Route[] = [
  {
    path: 'spaces/:spaceId/settings',
    title: 'Settings | Novan CMS',
    canActivate: [requirePermission('space.read')],
    loadComponent: () => import('./settings-page/settings-page').then((m) => m.SettingsPage),
  },
  {
    path: 'spaces/:spaceId/settings/site',
    title: 'Site settings | Novan CMS',
    canActivate: [requirePermission('space.read')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./site-settings-page/site-settings-page').then((m) => m.SiteSettingsPage),
  },
  {
    path: 'spaces/:spaceId/settings/navigation',
    title: 'Navigation | Novan CMS',
    canActivate: [requirePermission('space.read')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./navigation-page/navigation-page').then((m) => m.NavigationPage),
  },
  {
    path: 'spaces/:spaceId/settings/languages',
    title: 'Languages | Novan CMS',
    canActivate: [requirePermission('space.read')],
    loadComponent: () => import('./languages-page/languages-page').then((m) => m.LanguagesPage),
  },
  {
    path: 'spaces/:spaceId/settings/redirects',
    title: 'Redirects | Novan CMS',
    canActivate: [requirePermission('space.read')],
    loadComponent: () => import('./redirects-page/redirects-page').then((m) => m.RedirectsPage),
  },
  {
    path: 'spaces/:spaceId/settings/missing-pages',
    title: 'Missing pages | Novan CMS',
    canActivate: [requirePermission('space.read')],
    loadComponent: () => import('./not-found-page/not-found-page').then((m) => m.NotFoundPage),
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
