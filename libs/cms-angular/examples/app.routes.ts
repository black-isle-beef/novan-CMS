import type { Routes } from '@angular/router';
import { novanPageResolver } from '@novan/cms-angular';
import { CmsPage } from './cms-page';

export const routes: Routes = [
  // Every address is a CMS page; unknown ones resolve to null and answer 404. A `**` route has no params, so
  // the resolver must run again whenever the path changes.
  { path: '**', component: CmsPage, resolve: { page: novanPageResolver }, runGuardsAndResolvers: 'pathParamsChange' },
];
