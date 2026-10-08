import { expect, type Page, test } from '@playwright/test';
import { client, signIn } from './support/auth';
import { expectNoAxeViolations } from './support/axe';

// Needs local Supabase (`npm run db:start && npm run db:reset`); the API and admin start automatically.

/** Adds a block from the blocks field's picker; its fields open in a region named after it. */
async function addBlock(page: Page, block: string, position: number) {
  await page.getByLabel('Block to add').first().selectOption({ label: block });
  await page.getByRole('button', { name: 'Add block to Content' }).click();
  const region = page.getByRole('region', { name: `${block} block ${position}` });
  await expect(region).toBeVisible();
  return region;
}

test.describe('@content', () => {
  test('an editor creates a page with three blocks, publishes, edits and restores the first version', async ({
    page,
  }, testInfo) => {
    const title = `E2E page ${Date.now()} ${testInfo.project.name}`;

    // The client is an editor of the demo site.
    await signIn(page, client);
    await page.getByRole('link', { name: 'Demo site' }).click();
    await page.getByRole('navigation', { name: 'Space' }).getByRole('link', { name: 'Pages' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Pages' })).toBeVisible();
    await expectNoAxeViolations(page);

    // Create the page; its slug follows the title.
    await page.getByRole('button', { name: 'New page' }).click();
    const dialog = page.getByRole('dialog', { name: 'New page' });
    await dialog.getByLabel('Title').fill(title);
    await expect(dialog.getByLabel('Slug')).toHaveValue(title.toLowerCase().replace(/ /g, '-'));
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Create page' }).click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByText('Draft', { exact: true })).toBeVisible();

    // Three blocks: a hero, rich text and a call to action.
    const hero = await addBlock(page, 'Hero', 1);
    await hero.getByRole('textbox', { name: 'Heading (required)', exact: true }).fill('Welcome');
    const text = await addBlock(page, 'Rich text', 2);
    await text.getByRole('textbox', { name: 'Text' }).click();
    await page.keyboard.type('Hello from the rich text block.');
    const cta = await addBlock(page, 'Call to action', 3);
    await cta.getByRole('textbox', { name: 'Heading (required)', exact: true }).fill('Get in touch');
    await cta.getByLabel('Link to').selectOption({ label: 'A web address' });
    await cta.getByLabel('Web address').fill('https://example.com/contact');
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Draft saved.')).toBeVisible();

    // Publish.
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await page.getByRole('dialog', { name: /^Publish / }).getByRole('button', { name: /^Publish/ }).click();
    await expect(page.getByText(/^Published\. It is live at \//)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unpublish' })).toBeVisible();
    await expectNoAxeViolations(page);

    // Edit the hero (still open from when it was added) and publish the change.
    await expect(page.getByRole('button', { name: 'Edit Hero block 1' })).toHaveAttribute('aria-expanded', 'true');
    await page
      .getByRole('region', { name: 'Hero block 1' })
      .getByRole('textbox', { name: 'Heading (required)', exact: true })
      .fill('Welcome back');
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await page.getByRole('button', { name: 'Publish changes' }).click();
    await page.getByRole('dialog', { name: /^Publish / }).getByRole('button', { name: /^Publish/ }).click();
    await expect(page.getByText(/^Published\./)).toBeVisible();

    // Version history: compare the first version with the current one, then restore it.
    await page.getByRole('button', { name: 'Version history' }).click();
    const history = page.getByRole('dialog', { name: 'Version history' });
    await expect(history.getByText('Current', { exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
    const first = history.getByRole('listitem').last();
    await first.getByRole('button', { name: /^Compare with current/ }).click();
    await expect(history.getByText('Added a Hero block to Content')).toBeVisible();
    await first.getByRole('button', { name: /^Restore/ }).click();
    await history.getByRole('button', { name: 'Restore this version' }).click();

    await expect(page.getByText('Version restored. It is now the current draft.')).toBeVisible();
    await expect(page.getByText('No blocks yet.')).toBeVisible();
    await expect(page.getByText('Changes not published')).toBeVisible();
    await expectNoAxeViolations(page);

    // Clean up: delete it, and find it in the bin.
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog', { name: `Delete ${title}?` }).getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Pages' })).toBeVisible();
    await page.getByText(/^Bin \(\d+\)$/).click();
    await expect(page.getByRole('button', { name: `Restore ${title}` })).toBeVisible();
  });
});
