import type { Route } from '@angular/router';
import { cmsPageResolver } from './cms-page/cms-page.resolver';
import { siteContentResolver } from './site/site-content';

/**
 * Every address but `/search` is a CMS page. The layout's header and footer content is resolved on every navigation, in the
 * address's language (`/fr/...` when the site shows the language in addresses), from a cache of each language; the
 * page itself is resolved again whenever the address changes (`novanPageResolver` on a `**` route needs
 * `pathParamsChange`).
 */
export const appRoutes: Route[] = [
  {
    path: '',
    loadComponent: () => import('./site/site-layout').then((m) => m.SiteLayout),
    resolve: { site: siteContentResolver },
    runGuardsAndResolvers: 'always',
    children: [
      // Site search (package 18). A CMS page with the slug `search` would be hidden behind it.
      {
        path: 'search',
        loadComponent: () => import('./search-page/search-page').then((m) => m.SearchPage),
        runGuardsAndResolvers: 'paramsOrQueryParamsChange',
      },
      {
        path: '**',
        loadComponent: () => import('./cms-page/cms-page').then((m) => m.CmsPage),
        resolve: { page: cmsPageResolver },
        runGuardsAndResolvers: 'pathParamsChange',
      },
    ],
  },
];
