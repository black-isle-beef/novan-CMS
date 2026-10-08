import { expect, type Page, test } from '@playwright/test';
import { client, emailTo, signIn, signOut, spaceAdmin } from './support/auth';
import { expectNoAxeViolations } from './support/axe';

// Needs local Supabase (`npm run db:start && npm run db:reset`); the API (which emails through the local Mailpit),
// admin and starter site start automatically. docs/build/13-workflow-publishing.md.

const space = '00000000-0000-4000-8000-000000000200';
const contact = '00000000-0000-4000-8000-000000000703';

/** Turns approval on or off in Space settings, as the space admin. */
async function setApproval(page: Page, on: boolean): Promise<void> {
  await page.goto(`/spaces/${space}/settings/space`);
  const toggle = page.getByRole('switch', { name: 'Pages need approval before they are published' });
  await expect(toggle).toBeVisible();
  if ((await toggle.isChecked()) !== on) {
    await toggle.click();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Space settings saved.')).toBeVisible();
  }
}

test.describe('@workflow', () => {
  test('approval on: an editor submits a page, the space admin approves it, and it goes live', async ({ page }) => {
    test.setTimeout(180_000);
    const description = `How to reach us, updated ${Date.now()}`;

    await signIn(page, spaceAdmin);
    await expect(page.getByRole('link', { name: 'Demo site' })).toBeVisible();
    await setApproval(page, true);
    try {
      await signOut(page);

      // The client (an editor) changes the page and sends it for review: there is no Publish for them now.
      await signIn(page, client);
      await expect(page.getByRole('link', { name: 'Demo site' })).toBeVisible();
      await page.goto(`/spaces/${space}/content/${contact}`);
      await page.getByLabel('Search description').fill(description);
      await expect(page.getByRole('button', { name: 'Submit for review' })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Publish/ })).toHaveCount(0);
      const submitted = new Date();
      await page.getByRole('button', { name: 'Submit for review' }).click();
      const submit = page.getByRole('dialog', { name: 'Submit Contact for review?' });
      await submit.getByLabel('Note for the reviewer (optional)').fill('New description for search results');
      await expectNoAxeViolations(page);
      await submit.getByRole('button', { name: 'Submit for review' }).click();
      await expect(page.getByText('Sent for review.')).toBeVisible();
      await expect(page.getByText('Waiting for review').first()).toBeVisible();
      await expect(page.getByText('A space admin publishes it or asks for changes.')).toBeVisible();

      // The space admin is emailed.
      const request = await emailTo(spaceAdmin.email, 'Review requested: Contact', submitted);
      expect(request).toContain('New description for search results');
      await signOut(page);

      // The admin finds it in the inbox, compares it with the live page and approves it.
      await signIn(page, spaceAdmin);
      await page.getByRole('link', { name: 'Demo site' }).click();
      const inbox = page.getByRole('region', { name: 'Waiting for review' });
      await expect(inbox).toContainText('Sent by Client User');
      await inbox.getByRole('link', { name: 'Contact' }).click();
      await page.getByRole('button', { name: 'Compare with live' }).click();
      await expect(page.getByRole('table', { name: /live page and in this draft/ })).toContainText(description);
      const approved = new Date();
      await page.getByRole('button', { name: 'Approve and publish' }).click();
      const approve = page.getByRole('dialog', { name: 'Approve and publish Contact?' });
      await expect(approve.getByRole('table')).toContainText(description);
      await expect(approve).toContainText('Nothing to fix');
      await expectNoAxeViolations(page);
      await approve.getByRole('button', { name: 'Approve and publish' }).click();
      await expect(page.getByText('Approved and published. It is live at /contact.')).toBeVisible();

      // Whoever sent it is told, and the site shows it.
      const published = await emailTo(client.email, 'Published: Contact', approved);
      expect(published).toContain('It is live at /contact');
      await page.goto('http://localhost:4300/contact');
      await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', description);
    } finally {
      // Other journeys publish directly.
      await page.goto('/');
      const signOutButton = page.getByRole('button', { name: 'Sign out' });
      const signedIn = await signOutButton.waitFor({ timeout: 10_000 }).then(
        () => true,
        () => false,
      );
      if (signedIn) await signOut(page);
      await signIn(page, spaceAdmin);
      await expect(page.getByRole('link', { name: 'Demo site' })).toBeVisible();
      await setApproval(page, false);
    }
  });

  test('the recycle bin lists deleted pages for restoring', async ({ page }) => {
    await signIn(page, client);
    await page.getByRole('link', { name: 'Demo site' }).click();
    await page.getByRole('navigation', { name: 'Space' }).getByRole('link', { name: 'Pages' }).click();
    await page.getByRole('link', { name: 'Recycle bin' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Recycle bin' })).toBeVisible();
    await expect(page.getByText(/recycle bin is empty|Gone for good in/)).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
