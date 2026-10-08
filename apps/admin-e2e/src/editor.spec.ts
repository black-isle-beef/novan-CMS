import { expect, test } from '@playwright/test';
import { client, developer, signIn } from './support/auth';
import { expectNoAxeViolations } from './support/axe';

// Needs local Supabase (`npm run db:start && npm run db:reset`); the API, admin and starter site start
// automatically. The demo space's site is the starter site at http://localhost:4300 (supabase/seed.sql), with
// the seeded preview token (apps/starter-site/.env.serve).

test.describe('@editor', () => {
  test('an editor opens the home page on the site, picks a screen size and selects the hero', async ({ page }) => {
    // The site's first render compiles on demand in the dev server.
    test.setTimeout(90_000);
    await signIn(page, client);
    await page.getByRole('link', { name: 'Demo site' }).click();
    await page.getByRole('navigation', { name: 'Space' }).getByRole('link', { name: 'Pages' }).click();
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await page.getByRole('link', { name: 'Edit on the page' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    // The site, in preview mode, tells the admin it is ready.
    await expect(page.getByText('Showing the draft of /.')).toBeVisible({ timeout: 30_000 });
    const frame = page.frameLocator('iframe[title="Draft of Home"]');
    const hero = frame.locator('[data-novan-block="hero"]').first();
    await expect(hero).toBeVisible();

    // Clicking the hero selects it: outlined on the page, named in the panel.
    await hero.click();
    await expect(page.getByRole('complementary', { name: 'Block' })).toContainText('Hero');
    await expect(frame.locator('[data-novan-overlay]')).toContainText('Hero');

    // Screen sizes are a radio group: arrow keys move between them.
    await page.locator('label[for="nv-editor-device-mobile"]').click();
    await expect(page.getByRole('radio', { name: /Mobile/ })).toBeChecked();
    await expect(page.locator('iframe.nv-editor-frame-mobile')).toBeVisible();
    await page.getByRole('radio', { name: /Mobile/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: /Tablet/ })).toBeChecked();
    await expect(page.locator('iframe.nv-editor-frame-tablet')).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('an editor changes a page on the site: edits, adds, reorders, undoes, autosaves and publishes', async ({ page }) => {
    test.setTimeout(120_000);
    const heading = `Talk to us ${Date.now()}`;
    await signIn(page, client);
    await expect(page.getByRole('link', { name: 'Demo site' })).toBeVisible();
    // The seeded Contact page (supabase/seed.sql), so other journeys keep the home page as seeded.
    await page.goto('/spaces/00000000-0000-4000-8000-000000000200/pages/00000000-0000-4000-8000-000000000703/edit');
    await expect(page.getByText('Showing the draft of /contact.')).toBeVisible({ timeout: 30_000 });
    const frame = page.frameLocator('iframe[title="Draft of Contact"]');
    const panel = page.getByRole('complementary', { name: 'Block' });
    const outline = page.getByRole('region', { name: 'Blocks on this page' });

    // Click the hero on the page; change its heading in the panel; the page follows without reloading.
    await frame.locator('[data-novan-block="hero"]').first().click();
    await expect(panel).toContainText('Hero selected');
    await panel.getByRole('textbox', { name: /^Heading/ }).fill(heading);
    const heroHeading = frame.locator('[data-novan-block="hero"] h1, [data-novan-block="hero"] h2').first();
    await expect(heroHeading).toHaveText(heading);

    // Or change the text on the page itself: double-click, type, Enter.
    await heroHeading.dblclick();
    await heroHeading.press('End');
    await heroHeading.pressSequentially('!');
    await heroHeading.press('Enter');
    await expect(panel.getByRole('textbox', { name: /^Heading/ })).toHaveValue(`${heading}!`);

    // Add a call to action from the picker; it appears on the page and in the outline.
    await outline.getByRole('button', { name: 'Add block to Content' }).click();
    const picker = page.getByRole('dialog', { name: 'Add a block to Content' });
    await picker.getByRole('button', { name: 'Call to action' }).click();
    await expect(frame.locator('[data-novan-block="cta"]')).toHaveCount(2);

    // Reorder with the keyboard-friendly arrows: the rich text moves above the hero.
    await outline.getByRole('button', { name: 'Move Rich text up' }).click();
    await expect(frame.locator('[data-novan-block]').first()).toHaveAttribute('data-novan-block', 'richText');

    // Undo the move and the added block.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(frame.locator('[data-novan-block]').first()).toHaveAttribute('data-novan-block', 'hero');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(frame.locator('[data-novan-block="cta"]')).toHaveCount(1);
    await expect(frame.locator('[data-novan-block="hero"]').first()).toContainText(heading);

    // Autosave, then publish; the live site shows the change.
    await expect(page.getByText(/All changes saved at/)).toBeVisible({ timeout: 15_000 });
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Publish changes' }).click();
    // The publish dialog: what changes, the checklist and a message (docs/build/13-workflow-publishing.md).
    const publish = page.getByRole('dialog', { name: 'Publish Contact?' });
    await expect(publish.getByRole('table')).toContainText(heading);
    await publish.getByRole('button', { name: 'Publish changes' }).click();
    await expect(page.getByText('Published. It is live at /contact.')).toBeVisible();
    await page.goto('http://localhost:4300/contact');
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  });

  test('two people on one page: each sees the other, and only one changes it at a time', async ({ browser }) => {
    test.setTimeout(120_000);
    const about = '/spaces/00000000-0000-4000-8000-000000000200/pages/00000000-0000-4000-8000-000000000702/edit';
    const open = async (user: { email: string; password: string }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await signIn(page, user);
      await expect(page.getByRole('link', { name: 'Demo site' })).toBeVisible();
      await page.goto(about);
      await expect(page.getByText('Showing the draft of /about.')).toBeVisible({ timeout: 30_000 });
      return { context, page };
    };
    const first = await open(client);
    const second = await open(developer);

    // Each sees the other.
    await expect(first.page.getByRole('list', { name: 'Also on this page:' })).toContainText('Developer User');
    await expect(second.page.getByRole('list', { name: 'Also on this page:' })).toContainText('Client User');

    // The first changes the page: the second can look but not change it.
    await first.page.getByRole('region', { name: 'Blocks on this page' }).getByRole('button', { name: /^Hero/ }).click();
    const heading = first.page.getByRole('complementary', { name: 'Block' }).getByRole('textbox', { name: /^Heading/ });
    await heading.fill('About this site, edited together');
    await expect(second.page.getByText('Client User is changing this page')).toBeVisible({ timeout: 15_000 });
    await expect(second.page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
    await expectNoAxeViolations(second.page);

    // Put the page back, wait for the save, and leave: the second can edit, with what the first saved.
    await first.page.getByRole('button', { name: 'Undo' }).click();
    await expect(first.page.getByText('Changes not saved yet.')).toHaveCount(0, { timeout: 15_000 });
    await first.context.close();
    await expect(second.page.getByText('Client User is changing this page')).toHaveCount(0, { timeout: 30_000 });
    await expect(second.page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await second.context.close();
  });

  test('a preview link with a made-up token shows no drafts', async ({ page }) => {
    const response = await page.goto('http://localhost:4300/?novan_preview=made.up');
    expect(response?.headers()['cache-control']).not.toBe('private, no-store');
    await expect(page.locator('[data-novan-uid]')).toHaveCount(0);
  });
});
