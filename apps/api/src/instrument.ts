import * as Sentry from '@sentry/nestjs';

/**
 * Error reporting to Sentry (package 20) for the API and the worker. Imported before anything else in main.ts so the
 * SDK can instrument the modules that load after it. Off unless SENTRY_DSN is set: locally, in tests and in CI.
 */
const dsn = process.env['SENTRY_DSN'];
if (dsn) {
  Sentry.init({
    dsn,
    // `staging` or `production`; the release is the commit SHA the image was built from.
    environment: process.env['SENTRY_ENVIRONMENT'] ?? process.env['NODE_ENV'],
    release: process.env['APP_VERSION'],
    serverName: process.argv.includes('--worker') ? 'worker' : 'api',
    tracesSampleRate: Number(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? 0),
    // Headers, cookies, bodies, query strings and SQL can hold tokens and unpublished content: send none of them.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
    },
  });
}
