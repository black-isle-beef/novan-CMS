import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';

// For CI, you may want to set BASE_URL to the deployed application.
const baseURL = process.env['BASE_URL'] || 'http://localhost:4100';

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
 * The marketing site needs no API or database: its pages are static, and the contact tests answer the form's
 * requests themselves. `nx serve web` gives the server a placeholder contact form (apps/web/.env.serve).
 */
export default defineConfig({
  ...nxE2EPreset(import.meta.dirname, { testDir: './src' }),
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'npx nx run web:serve',
      url: 'http://localhost:4100/health',
      reuseExistingServer: true,
      cwd: workspaceRoot,
      timeout: 180_000,
    },
  ],
  projects: browsers.map((name) => ({ name, use: { ...allBrowsers[name] } })),
});
