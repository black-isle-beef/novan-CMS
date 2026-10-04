import { type ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { provideServerRendering, RenderMode, withRoutes } from '@angular/ssr';
import { provideNovanCmsServer } from '@black-isle-beef/cms-angular';
import { appConfig } from './app.config';
import { novanServerOptions } from './novan.server';

export const config = mergeApplicationConfig(appConfig, {
  providers: [
    provideServerRendering(withRoutes([{ path: '**', renderMode: RenderMode.Server }])),
    provideNovanCmsServer(novanServerOptions),
  ],
} satisfies ApplicationConfig);
