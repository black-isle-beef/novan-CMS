import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';

// For CI, you may want to set BASE_URL to the deployed application.
const baseURL = process.env['BASE_URL'] || 'http://localhost:4300';

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

/** Journeys that publish seeded content: once, in chromium, after the read-only tests (below). */
const publishing = /(gate-1|seo-publish|forms|listing)\.spec\.ts/;

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
export default defineConfig({
  ...nxE2EPreset(import.meta.dirname, { testDir: './src' }),
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    baseURL,
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },
  // The site renders every page from the API, which reads the seeded content (`npm run db:reset`). `nx serve`
  // gives the site the seeded delivery token (apps/starter-site/.env.serve). No `env` here: Nx would then not
  // start these servers as tasks, and `nx e2e` could not run.
  webServer: [
    {
      command: 'npx nx run api:serve',
      url: 'http://localhost:3000/health',
      reuseExistingServer: true,
      cwd: workspaceRoot,
      timeout: 180_000,
    },
    {
      command: 'npx nx run starter-site:serve',
      url: 'http://localhost:4300/health',
      reuseExistingServer: true,
      cwd: workspaceRoot,
      timeout: 180_000,
    },
  ],
  projects: [
    ...browsers.map((name) => ({ name, use: { ...allBrowsers[name] }, testIgnore: publishing })),

    // The publishing journeys run only with chromium: the nightly firefox and webkit runs check the read-only
    // pages, not publishing again.
    ...(browsers.includes('chromium')
      ? [
          // Gate 1 publishes a change to seeded content, so it runs once, after the other tests have read it.
          {
            name: 'gate-1',
            use: { ...devices['Desktop Chrome'] },
            testMatch: /gate-1\.spec\.ts/,
            dependencies: browsers,
          },

          // SEO journeys that publish (a new slug, new pages), likewise once and after the read-only tests.
          {
            name: 'seo-publish',
            use: { ...devices['Desktop Chrome'] },
            testMatch: /seo-publish\.spec\.ts/,
            dependencies: browsers,
          },

          // Forms send submissions and publish a page (package 18), likewise once and after the read-only tests. After
          // seo-publish too: it moves the contact page to /get-in-touch for a while, and the inbox records the form's path.
          {
            name: 'forms',
            use: { ...devices['Desktop Chrome'] },
            testMatch: /forms\.spec\.ts/,
            dependencies: [...browsers, 'seo-publish'],
          },

          // The blog kit's listing block and feed (package 19) add a content type and a block type for a while, so they
          // run last.
          {
            name: 'kits',
            use: { ...devices['Desktop Chrome'] },
            testMatch: /listing\.spec\.ts/,
            dependencies: [...browsers, 'gate-1', 'seo-publish', 'forms'],
          },
        ]
      : []),

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
