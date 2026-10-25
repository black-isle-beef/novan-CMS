import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';

// For CI, you may want to set BASE_URL to the deployed application.
const baseURL = process.env['BASE_URL'] || 'http://localhost:4200';

const allBrowsers = {
  chromium: devices['Desktop Chrome'],
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
};

/**
 * The browsers to run, from E2E_BROWSERS (comma-separated): CI runs chromium on every change and firefox and webkit
 * nightly (.github/workflows/e2e-nightly.yml). All three when unset.
 */
const browsers = (process.env['E2E_BROWSERS'] || Object.keys(allBrowsers).join(','))
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean)
  .map((name) => {
    if (!(name in allBrowsers)) throw new Error(`E2E_BROWSERS: unknown browser "${name}" (use ${Object.keys(allBrowsers).join(', ')})`);
    return name as keyof typeof allBrowsers;
  });

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import 'dotenv/config';

/**
 * See https://playwright.dev/docs/test-configuration.
 *
 * Generated as a .mts file so Node forces ESM regardless of workspace
 * `type`. Playwright routes `.mts` through its ESM loader (dynamic import,
 * bypassing the pirates CJS-compile path), and Nx's native TS strip loads
 * `.mts` directly. Playwright's configLoader auto-discovers
 * `playwright.config.mts` via its extension list
 * (.ts/.js/.mts/.mjs/.cts/.cjs).
 */
/**
 * The command for a dev server Playwright needs. Run through Nx (`nx e2e`), the servers are this target's continuous
 * dependencies (Nx infers them from these commands) and are already starting: a nested `nx run` would be refused as
 * a recursive invocation (Nx 24), so Playwright only waits for their address. Run directly (`npx playwright test`), it
 * starts them itself.
 */
const serve = (project: string): string =>
  process.env['NX_TASK_TARGET_PROJECT'] ? 'node -e "setInterval(() => {}, 1 << 30)"' : `npx nx run ${project}:serve`;
export default defineConfig({
  ...nxE2EPreset(import.meta.dirname, { testDir: './src' }),
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    baseURL,
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },
  /* Run the admin and the API before starting the tests (local Supabase must already be running). */
  webServer: [
    {
      command: serve('admin'),
      url: 'http://localhost:4200',
      reuseExistingServer: true,
      cwd: workspaceRoot,
    },
    {
      command: serve('api'),
      url: 'http://localhost:3000/health',
      reuseExistingServer: true,
      cwd: workspaceRoot,
      timeout: 180_000,
    },
    // The demo space's site (its address in supabase/seed.sql), framed by the visual editor (@editor).
    {
      command: serve('starter-site'),
      url: 'http://localhost:4300/health',
      reuseExistingServer: true,
      cwd: workspaceRoot,
      timeout: 180_000,
    },
  ],
  // Tests run one at a time: several sign the seeded agency user in with MFA, and Supabase Auth ends that
  // user's other password-only sessions when a second factor is verified. The browsers do not depend on each
  // other, so a failure in one does not skip the others.
  workers: 1,
  projects: [
    ...browsers.map((name) => ({ name, use: { ...allBrowsers[name] } })),

    // Uncomment for mobile browsers support
    /* {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    }, */

    // Uncomment for branded browsers
    /* {
      name: 'Microsoft Edge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
    {
      name: 'Google Chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    } */
  ],
});
