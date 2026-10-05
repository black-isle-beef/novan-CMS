import type { Route } from '@angular/router';
import { cmsPageResolver } from './cms-page/cms-page.resolver';
import { siteContentResolver } from './site/site-content';

/**
 * Every address is a CMS page. The layout's header and footer content loads once; the page itself is
 * resolved again whenever the address changes (`novanPageResolver` on a `**` route needs `pathParamsChange`).
 */
export const appRoutes: Route[] = [
  {
    path: '',
    loadComponent: () => import('./site/site-layout').then((m) => m.SiteLayout),
    resolve: { site: siteContentResolver },
    children: [
      {
        path: '**',
        loadComponent: () => import('./cms-page/cms-page').then((m) => m.CmsPage),
        resolve: { page: cmsPageResolver },
        runGuardsAndResolvers: 'pathParamsChange',
      },
    ],
  },
];
