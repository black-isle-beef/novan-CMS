import * as Sentry from '@sentry/node';

/**
 * Error reporting to Sentry for the site's server (package 20). Off unless SENTRY_DSN is set: locally, in tests and in
 * CI. Only server errors are reported; the browser bundle has no SDK.
 */
export function startMonitoring(env: NodeJS.ProcessEnv = process.env): boolean {
  const dsn = env['SENTRY_DSN'];
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: env['SENTRY_ENVIRONMENT'] ?? env['NODE_ENV'],
    // The commit SHA the image was built from.
    release: env['APP_VERSION'],
    serverName: 'site',
    tracesSampleRate: Number(env['SENTRY_TRACES_SAMPLE_RATE'] ?? 0),
    // Preview links carry signed tokens in the query string, and requests carry cookies: send neither.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
  });
  return true;
}

export const reportServerErrors = Sentry.setupExpressErrorHandler;
