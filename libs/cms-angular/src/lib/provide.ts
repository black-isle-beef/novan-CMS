import { type EnvironmentProviders, inject, makeEnvironmentProviders, provideEnvironmentInitializer } from '@angular/core';
import { NOVAN_CMS_CONFIG, NOVAN_CMS_SERVER, type NovanCmsConfig, type NovanServerOptions } from './config';
import { NovanPreview } from './preview';

/**
 * Sets up the SDK for the app (`app.config.ts`): content fetching, block rendering and preview mode.
 * Needs `provideHttpClient(withFetch())` too. The server adds its tokens with {@link provideNovanCmsServer}.
 */
export function provideNovanCms(config: NovanCmsConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: NOVAN_CMS_CONFIG, useValue: config },
    provideEnvironmentInitializer(() => inject(NovanPreview).start()),
  ]);
}

/** Gives the server its API address and tokens (`app.config.server.ts`, never `app.config.ts`). */
export function provideNovanCmsServer(options: NovanServerOptions): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: NOVAN_CMS_SERVER, useValue: options }]);
}
