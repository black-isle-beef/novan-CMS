import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { defineBlocks, provideNovanCms } from '@black-isle-beef/cms-angular';
import { appRoutes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';

export const appConfig: ApplicationConfig = {
  providers: [
    provideClientHydration(withEventReplay()),
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    provideHttpClient(withFetch()),
    // No tokens here: this config is in the browser bundle. The server adds them (app.config.server.ts).
    // The blocks arrive with package 10.
    provideNovanCms({ blocks: defineBlocks({}) }),
  ],
};
