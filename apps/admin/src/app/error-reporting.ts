import { ErrorHandler, type Provider } from '@angular/core';
import type { RuntimeConfig } from '../environments/runtime-config';

type SentryModule = typeof import('@sentry/angular');

/**
 * Error reporting to Sentry (package 20), on only when the deployed admin's config.js sets `sentryDsn`. The SDK loads
 * in its own chunk, so admins without it never download it; errors before it loads are still logged to the console.
 */
export function provideErrorReporting(config: RuntimeConfig): Provider[] {
  const dsn = config.sentryDsn;
  if (!dsn) return [];
  const sentry = import('@sentry/angular').then((Sentry) => {
    Sentry.init({
      dsn,
      environment: config.environment,
      release: config.release,
      // Query strings can hold invite and sign-in tokens, and requests carry the access token: send neither.
      dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    });
    return Sentry;
  });
  return [{ provide: ErrorHandler, useValue: new ReportingErrorHandler(sentry) }];
}

/** Angular's own handler (it logs to the console), then Sentry once loaded. */
class ReportingErrorHandler extends ErrorHandler {
  constructor(private readonly sentry: Promise<SentryModule>) {
    super();
  }

  override handleError(error: unknown): void {
    super.handleError(error);
    void this.sentry.then((Sentry) => Sentry.captureException(error)).catch(() => undefined);
  }
}
