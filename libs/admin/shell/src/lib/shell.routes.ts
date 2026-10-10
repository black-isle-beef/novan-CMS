import type { Route } from '@angular/router';
import { requirePermission } from '@novan/admin-spaces';
import { copy } from './copy/copy';

const placeholder = () => import('./placeholder-page/placeholder-page').then((m) => m.PlaceholderPage);

/**
 * Menu sections that are placeholders until their package: Forms (18) and the Audit log (18). Each is guarded by the
 * same permission as its menu link. (Webhooks arrived in package 17: `@novan/admin-settings`.)
 */
export const placeholderRoutes: Route[] = [
  {
    path: 'spaces/:spaceId/forms',
    title: 'Forms | Novan CMS',
    canActivate: [requirePermission('content.read')],
    data: { heading: copy.forms, lead: 'Forms on your site, and what visitors send through them, will be here.' },
    loadComponent: placeholder,
  },
  {
    path: 'spaces/:spaceId/audit-log',
    title: 'Audit log | Novan CMS',
    canActivate: [requirePermission('audit.read')],
    data: { heading: 'Audit log', lead: 'Who changed what in this space, and when.' },
    loadComponent: placeholder,
  },
];
