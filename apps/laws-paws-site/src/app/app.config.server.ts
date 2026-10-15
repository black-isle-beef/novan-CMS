import { DOCUMENT, inject, mergeApplicationConfig, TransferState, type ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { provideNovanCmsServer } from '@black-isle-beef/cms-angular';
import { novanServerOptions, siteUrl } from '../novan.server';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { SITE_URL, SITE_URL_STATE } from './site/site-url';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    provideNovanCmsServer(novanServerOptions),
    // `SITE_URL` from the server environment (or the request's origin), passed on to the browser.
    {
      provide: SITE_URL,
      useFactory: () => {
        const url = siteUrl(inject(DOCUMENT).location.origin);
        inject(TransferState).set(SITE_URL_STATE, url);
        return url;
      },
    },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);