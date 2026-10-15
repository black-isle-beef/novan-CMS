import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling, withRouterConfig } from '@angular/router';
import { provideNovanCms } from '@black-isle-beef/cms-angular';
import { novanBlocks } from '@novan/blocks';
import { appRoutes } from './app.routes';
import { cacheTagInterceptor } from './cache/cache-tags';

export const appConfig: ApplicationConfig = {
  providers: [
    provideClientHydration(withEventReplay()),
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      appRoutes,
      // Resolved data reaches the components as inputs; the page also sees the layout's `site`.
      withComponentInputBinding(),
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
    ),
    provideHttpClient(withFetch(), withInterceptors([cacheTagInterceptor])),
    // No tokens here: this config is in the browser bundle. The server adds them (app.config.server.ts).
    provideNovanCms({ blocks: novanBlocks }),
  ],
};
