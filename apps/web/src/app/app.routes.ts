import type { Route } from '@angular/router';
import { notFoundPage, pages } from '@novan/marketing-content';
import { SiteLayout } from './layout/site-layout';
import type { SeoConfig } from './seo/seo.service';
import { homeJsonLd } from './seo/structured-data';

const seo = (config: SeoConfig) => ({ seo: config });

export const appRoutes: Route[] = [
  {
    path: '',
    component: SiteLayout,
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('./pages/home/home-page').then((m) => m.HomePage),
        data: seo({ ...pages.home, jsonLd: homeJsonLd }),
      },
      {
        path: 'features',
        loadComponent: () => import('./pages/features/features-page').then((m) => m.FeaturesPage),
        data: seo(pages.features),
      },
      {
        path: 'pricing',
        loadComponent: () => import('./pages/pricing/pricing-page').then((m) => m.PricingPage),
        data: seo(pages.pricing),
      },
      {
        path: 'contact',
        loadComponent: () => import('./pages/contact/contact-page').then((m) => m.ContactPage),
        data: seo(pages.contact),
      },
      {
        path: 'privacy',
        loadComponent: () => import('./pages/legal/legal-page').then((m) => m.LegalPage),
        data: { ...seo(pages.privacy), document: 'privacy' },
      },
      {
        path: 'cookies',
        loadComponent: () => import('./pages/legal/legal-page').then((m) => m.LegalPage),
        data: { ...seo(pages.cookies), document: 'cookies' },
      },
      {
        path: 'accessibility',
        loadComponent: () => import('./pages/legal/legal-page').then((m) => m.LegalPage),
        data: { ...seo(pages.accessibility), document: 'accessibility' },
      },
      {
        path: '**',
        loadComponent: () => import('./pages/not-found/not-found-page').then((m) => m.NotFoundPage),
        data: seo({ ...notFoundPage, noIndex: true }),
      },
    ],
  },
];
