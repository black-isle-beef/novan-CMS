import { DOCUMENT, inject, mergeApplicationConfig, TransferState, type ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { siteUrl, webServerConfig } from '../web.server';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { SITE_CONFIG, SITE_CONFIG_STATE, type SiteConfig } from './config/site-config';

const server = webServerConfig();

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    // The environment's addresses, passed on to the browser with the page. The delivery token is not among them.
    {
      provide: SITE_CONFIG,
      useFactory: (): SiteConfig => {
        const config: SiteConfig = {
          siteUrl: siteUrl(server, inject(DOCUMENT).location.origin),
          cmsLoginUrl: server.cmsLoginUrl,
          contactForm: server.contactForm,
        };
        inject(TransferState).set(SITE_CONFIG_STATE, config);
        return config;
      },
    },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
