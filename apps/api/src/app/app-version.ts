export const APP_VERSION = Symbol('APP_VERSION');

export const DEV_VERSION = '0.0.0-dev';

/** Release version reported by /health. Deployments set APP_VERSION (git tag or SHA). */
export function resolveAppVersion(env: NodeJS.ProcessEnv = process.env): string {
  return env['APP_VERSION'] || DEV_VERSION;
}
