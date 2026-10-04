import { provideHttpClient, withFetch } from '@angular/common/http';
import type { ApplicationConfig } from '@angular/core';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { defineBlocks, provideNovanCms } from '@novan/cms-angular';
import { routes } from './app.routes';
import { HeroBlock } from './hero.block';

// Shared by the server and the browser: no tokens here.
export const appConfig: ApplicationConfig = {
  providers: [
    provideClientHydration(withEventReplay()),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch()),
    provideNovanCms({
      locale: 'en-GB',
      blocks: defineBlocks({ hero: HeroBlock }),
    }),
  ],
};
