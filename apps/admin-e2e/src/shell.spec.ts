import { expect, type Page, test } from '@playwright/test';
import { client, developer, signIn, signInAsAgency } from './support/auth';
import { expectNoAxeViolations } from './support/axe';

// Needs local Supabase (`npm run db:start && npm run db:reset`); the API and admin start automatically.

/** The seeded demo space (supabase/seed.sql). */
const demoSpaceId = '00000000-0000-4000-8000-000000000200';
/** Its home page. */
const homePageId = '00000000-0000-4000-8000-000000000701';

const clientMenu = ['Dashboard', 'Pages', 'Media', 'Forms', 'Settings'];

/**
 * Words client roles must never see (`agencyOnlyWords` in libs/admin/shell/src/lib/copy/copy.ts). As whole
 * words, in any case.
 */
const agencyOnlyWords = /\b(entry|entries|environments?|content\s+types?)\b/i;

const spaceMenu = (page: Page) => page.getByRole('navigation', { name: 'Space' });

/** Everything a person can perceive on the page: visible text, accessible names and descriptions, and the title. */
async function perceivableText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const attributes = ['aria-label', 'title', 'placeholder', 'alt'];
    const named = [...document.querySelectorAll('*')].flatMap((el) =>
      attributes.map((name) => el.getAttribute(name)).filter((value): value is string => !!value),
    );
    return [document.title, document.body.innerText, ...named].join('\n');
  });
}

test.describe('@shell', () => {
  test('an editor sees the client menu only, and never an agency word', async ({ page }) => {
    await signIn(page, client);
    await page.getByRole('link', { name: 'Demo site' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(spaceMenu(page).getByRole('link')).toHaveText(clientMenu);
    await expect(spaceMenu(page).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    await expectNoAxeViolations(page);

    // Every client screen, including a page in the editor, in plain language.
    const screens: [path: string, heading: string][] = [
      ['', 'Dashboard'],
      ['/content', 'Pages'],
      [`/content/${homePageId}`, 'Home'],
      ['/media', 'Media'],
      ['/forms', 'Forms'],
      ['/settings', 'Settings'],
      ['/members', 'Team'],
    ];
    for (const [path, heading] of screens) {
      await page.goto(`/spaces/${demoSpaceId}${path}`);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      // Wait for loading placeholders to give way to the content.
      await expect(page.locator('.placeholder-glow')).toHaveCount(0);
      expect(await perceivableText(page), `an agency-only word on ${path || 'the dashboard'}`).not.toMatch(agencyOnlyWords);
      await expectNoAxeViolations(page);
    }

    // Agency screens are not reachable by address either: the dashboard opens instead.
    for (const path of ['schema', 'settings/api-tokens', 'settings/space', 'webhooks', 'audit-log']) {
      await page.goto(`/spaces/${demoSpaceId}/${path}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    }
  });

  test('a developer sees the schema, API tokens and webhooks too', async ({ page }) => {
    await signIn(page, developer);
    await page.getByRole('link', { name: 'Demo site' }).click();
    await expect(spaceMenu(page).getByRole('link')).toHaveText([...clientMenu, 'Schema', 'API tokens', 'Webhooks']);

    await spaceMenu(page).getByRole('link', { name: 'Schema' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Schema' })).toBeVisible();
    await expect(spaceMenu(page).getByRole('link', { name: 'Schema' })).toHaveAttribute('aria-current', 'page');

    await spaceMenu(page).getByRole('link', { name: 'Webhooks' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Webhooks' })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('a new space opens with a checklist that anyone who edits can dismiss', async ({ page }, testInfo) => {
    const slug = `shell-${Date.now()}-${testInfo.project.name}`;
    await signInAsAgency(page);
    await page.getByRole('link', { name: 'Create a space' }).click();
    await page.getByLabel('Client or site name').fill('Checklist Ltd');
    await page.getByLabel('Short name').fill(slug);
    await page.getByRole('button', { name: 'Create space' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    const checklist = page.getByRole('region', { name: 'Get started' });
    await expect(checklist).toContainText('0 of 4 done');
    await expect(checklist.getByRole('heading', { level: 3 })).toHaveText([
      'Add your logo (not done yet)',
      'Edit your home page (not done yet)',
      'Add a page (not done yet)',
      'Publish a page (not done yet)',
    ]);
    // At 0% the bar has no width, so check its value rather than its visibility.
    await expect(checklist.getByRole('progressbar', { name: 'Getting started' })).toHaveAttribute('aria-valuenow', '0');
    await expectNoAxeViolations(page);

    // Dismissing asks first, and is for everyone: it stays gone after a reload.
    await checklist.getByRole('button', { name: 'Dismiss checklist' }).click();
    const confirm = page.getByRole('dialog', { name: 'Dismiss the checklist?' });
    await expect(confirm).toBeVisible();
    await expectNoAxeViolations(page);
    await confirm.getByRole('button', { name: 'Dismiss checklist' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Checklist dismissed.' })).toBeVisible();
    await expect(checklist).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Get started' })).toHaveCount(0);
  });

  test('agency staff view the space as an editor: client menu, read only, then back', async ({ page }) => {
    await signInAsAgency(page);
    await page.getByRole('link', { name: 'Demo site' }).click();
    await expect(spaceMenu(page).getByRole('link', { name: 'Audit log' })).toBeVisible();

    await page.getByRole('button', { name: 'View as' }).click();
    await page.getByRole('menuitem', { name: 'Editor' }).click();

    const banner = page.getByRole('region', { name: 'Viewing as' });
    await expect(banner).toContainText('Viewing as Editor.');
    await expect(spaceMenu(page).getByRole('link')).toHaveText(clientMenu);
    await expect(page.getByRole('link', { name: 'New page' })).toHaveCount(0);
    await expectNoAxeViolations(page);

    // Pages open read only. (In-app navigation: viewing as ends with a reload.)
    await spaceMenu(page).getByRole('link', { name: 'Pages' }).click();
    await page.getByRole('main').getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0);
    await expect(banner).toBeVisible();

    await banner.getByRole('button', { name: 'Stop viewing as' }).click();
    await expect(banner).toHaveCount(0);
    await expect(spaceMenu(page).getByRole('link', { name: 'Schema' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save draft' })).toBeVisible();
  });

  test('admins reach the settings screens; on a narrow screen the space menu moves into the header menu', async ({ page }) => {
    await signIn(page, { email: 'novanwebservices@gmail.com', password: 'password123' });
    await page.getByRole('link', { name: 'Demo site' }).click();
    await spaceMenu(page).getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('main').getByRole('link')).toHaveText(['Site settings', 'Team', 'API tokens', 'Space settings']);
    await expectNoAxeViolations(page);

    await page.getByRole('main').getByRole('link', { name: 'Space settings' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Space settings' })).toBeVisible();
    await expect(page.getByLabel('Client or site name')).toHaveValue('Demo site');
    await expectNoAxeViolations(page);

    await page.setViewportSize({ width: 375, height: 800 });
    await expect(spaceMenu(page)).toHaveCount(0);
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button').first().click();
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Pages' })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});