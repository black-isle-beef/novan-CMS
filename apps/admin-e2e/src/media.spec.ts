import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { client, signIn } from './support/auth';
import { expectNoAxeViolations } from './support/axe';

// Needs local Supabase (`npm run db:start && npm run db:reset`); the API and admin start automatically.

const png = (background: string) =>
  sharp({ create: { width: 160, height: 90, channels: 3, background } })
    .png()
    .toBuffer();

test.describe('@media', () => {
  test('an editor uploads three images, describes one, picks it in a hero block and publishes', async ({
    page,
  }, testInfo) => {
    const run = `${Date.now()}-${testInfo.project.name}`;
    const names = [1, 2, 3].map((n) => `e2e-${run}-${n}.png`);
    const title = (n: number) => `e2e ${run.replace(/-/g, ' ')} ${n}`;

    await signIn(page, client);
    await page.getByRole('link', { name: 'Demo site' }).click();
    await page.getByRole('navigation', { name: 'Space' }).getByRole('link', { name: 'Media' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Media' })).toBeVisible();
    await expectNoAxeViolations(page);

    // Three at once, straight to storage, each checked by the API.
    await page.getByLabel('Upload files').setInputFiles([
      { name: names[0], mimeType: 'image/png', buffer: await png('#c0392b') },
      { name: names[1], mimeType: 'image/png', buffer: await png('#2980b9') },
      { name: names[2], mimeType: 'image/png', buffer: await png('#27ae60') },
    ]);
    await expect(page.getByText('3 files uploaded.')).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(`^${title(1)}`) })).toBeVisible();

    // The list view too.
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(page.getByRole('table')).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Grid', exact: true }).click();

    // Alt text and a focal point, in the file's details.
    await page.getByRole('button', { name: new RegExp(`^${title(1)}`) }).click();
    const details = page.getByRole('dialog', { name: title(1) });
    await expect(details.getByText('Not used on any published page')).toBeVisible();
    await details.getByLabel('Alternative text').fill('A red square, used in the hero');
    await details.getByLabel('From the left').fill('30');
    await details.getByLabel('From the top').fill('70');
    await expect(details.getByText('30% from the left, 70% from the top.')).toBeVisible();
    // The image itself takes the arrow keys.
    await details.getByRole('button', { name: 'Set the focal point' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(details.getByText('35% from the left, 70% from the top.')).toBeVisible();
    await expectNoAxeViolations(page);
    await details.getByRole('button', { name: 'Save details' }).click();
    await expect(details.getByText('Details saved.')).toBeVisible();
    await details.getByRole('button', { name: 'Close file details' }).click();

    // A page with a hero block that uses it.
    await page.getByRole('navigation', { name: 'Space' }).getByRole('link', { name: 'Pages' }).click();
    await page.getByRole('button', { name: 'New page' }).click();
    const create = page.getByRole('dialog', { name: 'New page' });
    await create.getByLabel('Title').fill(`Media page ${run}`);
    await create.getByRole('button', { name: 'Create page' }).click();
    await expect(page.getByRole('heading', { level: 1, name: `Media page ${run}` })).toBeVisible();

    await page.getByLabel('Block to add').first().selectOption({ label: 'Hero' });
    await page.getByRole('button', { name: 'Add block to Content' }).click();
    const hero = page.getByRole('region', { name: 'Hero block 1' });
    await hero.getByRole('textbox', { name: 'Heading (required)', exact: true }).fill('Welcome');
    await hero.getByRole('button', { name: 'Choose an image for Background image' }).click();

    const picker = page.getByRole('dialog', { name: 'Choose an image for Background image' });
    await picker.getByLabel('Search the library').fill(title(1));
    await picker.getByRole('button', { name: new RegExp(`^${title(1)}`) }).click();
    await expect(picker.getByText('1 file, 1 chosen')).toBeVisible();
    await expectNoAxeViolations(page);
    await picker.getByRole('button', { name: 'Choose', exact: true }).click();

    // The library's alt text is used, so the page needs none of its own.
    await expect(hero.getByText(title(1), { exact: true })).toBeVisible();
    // Focus lands on the control that replaced the one that opened the picker.
    await expect(hero.getByRole('button', { name: `Change ${title(1)} in Background image` })).toBeFocused();
    await expect(hero.getByText('Leave empty to use the library\'s: "A red square, used in the hero".')).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText(/^Published\. It is live at \//)).toBeVisible();

    // The library now knows where the image is used, and warns before deleting it.
    await page.getByRole('navigation', { name: 'Space' }).getByRole('link', { name: 'Media' }).click();
    await page.getByRole('button', { name: new RegExp(`^${title(1)}`) }).click();
    await expect(details.getByText('Used on 1 published page')).toBeVisible();
    await expect(details.getByRole('link', { name: `Media page ${run}` })).toBeVisible();
    await details.getByRole('button', { name: 'Delete' }).click();
    const confirm = page.getByRole('dialog', { name: `Delete ${title(1)}?` });
    await expect(confirm.getByText('It is in use on 1 published page.')).toBeVisible();
    await expectNoAxeViolations(page);
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await details.getByRole('button', { name: 'Close file details' }).click();

    // Clean up: the other two images go to the bin; the page goes to the bin, which unpublishes it.
    for (const n of [2, 3]) {
      await page.getByRole('button', { name: new RegExp(`^${title(n)}`) }).click();
      const other = page.getByRole('dialog', { name: title(n) });
      await other.getByRole('button', { name: 'Delete' }).click();
      await page
        .getByRole('dialog', { name: `Delete ${title(n)}?` })
        .getByRole('button', { name: 'Delete' })
        .click();
      await expect(other.getByText('Moved to the bin.')).toBeVisible();
      await other.getByRole('button', { name: 'Close file details' }).click();
    }
    await page.getByRole('navigation', { name: 'Space' }).getByRole('link', { name: 'Pages' }).click();
    await page.getByRole('link', { name: `Media page ${run}` }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page
      .getByRole('dialog', { name: `Delete Media page ${run}?` })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Pages' })).toBeVisible();
  });
});
