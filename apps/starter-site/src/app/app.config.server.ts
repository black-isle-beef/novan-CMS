import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { provideNovanCmsServer } from '@black-isle-beef/cms-angular';
import { novanServerOptions } from '../novan.server';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';

const serverConfig: ApplicationConfig = {
  providers: [provideServerRendering(withRoutes(serverRoutes)), provideNovanCmsServer(novanServerOptions)],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
