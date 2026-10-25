import { expect, test } from '@playwright/test';
import { client, signIn } from './support/auth';
import { expectNoAxeViolations } from './support/axe';
import { keepPublished } from './support/management';

// Classes on a block's parts (docs/build/24-design-systems.md, 24b). Needs local Supabase, like editor.spec.ts; the
// seeded Contact page is published as it was afterwards.

test.describe('@editor @classes', () => {
  test('an editor adds classes to parts of a block, sees them on the page, and the live page has them', async ({ page, request }) => {
    test.setTimeout(120_000);
    const putBack = await keepPublished(request, '00000000-0000-4000-8000-000000000200', '00000000-0000-4000-8000-000000000703');
    try {
      await signIn(page, client);
      await expect(page.getByRole('link', { name: 'Demo site' })).toBeVisible();
      await page.goto('/spaces/00000000-0000-4000-8000-000000000200/pages/00000000-0000-4000-8000-000000000703/edit');
      await expect(page.getByText('Showing the draft of /contact.')).toBeVisible({ timeout: 30_000 });
      const frame = page.frameLocator('iframe[title="Draft of Contact"]');
      const panel = page.getByRole('complementary', { name: 'Block' });
      const hero = frame.locator('[data-novan-block="hero"] [data-novan-part="root"]').first();

      await frame.locator('[data-novan-block="hero"]').first().click();
      await expect(panel).toContainText('Hero selected');

      // The site says which parts the hero has; the whole block comes first.
      const part = panel.getByRole('combobox', { name: 'Part' });
      await expect(part.getByRole('option', { name: 'Heading' })).toBeAttached();

      // Classes on the whole block, typed and added with Enter; the page follows without reloading.
      const classes = panel.getByRole('textbox', { name: 'Classes on Whole block' });
      await classes.fill('mt-5 shadow-lg');
      await classes.press('Enter');
      await expect(hero).toHaveClass(/(^|\s)mt-5(\s|$)/);
      await expect(hero).toHaveClass(/(^|\s)shadow-lg(\s|$)/);
      await expect(hero).toHaveClass(/novan-hero-block/);
      await expect(panel.getByRole('status')).toHaveText('Added mt-5, shadow-lg.');

      // And on the heading, while the site outlines the part being edited.
      await part.selectOption({ label: 'Heading' });
      const headingClasses = panel.getByRole('textbox', { name: 'Classes on Heading' });
      await headingClasses.focus();
      await expect(frame.locator('[data-novan-part-outline]').first()).toBeVisible();
      await headingClasses.fill('display-1');
      await headingClasses.press('Enter');
      const heading = frame.locator('[data-novan-block="hero"] [data-novan-part="heading"]').first();
      await expect(heading).toHaveClass(/(^|\s)display-1(\s|$)/);

      // Something that is not a class name is refused, and said so.
      await headingClasses.fill('"><b>');
      await headingClasses.press('Enter');
      await expect(headingClasses).toHaveAttribute('aria-invalid', 'true');
      await expect(panel.getByRole('status')).toContainText('is not a class name');
      await headingClasses.fill('');

      // Removing with the keyboard: Backspace in the empty box takes the last class off.
      await headingClasses.press('Backspace');
      await expect(heading).not.toHaveClass(/(^|\s)display-1(\s|$)/);
      await headingClasses.fill('display-4');
      await headingClasses.press('Enter');

      await expect(page.getByText(/All changes saved at/)).toBeVisible({ timeout: 15_000 });
      await expectNoAxeViolations(page);

      // Published, the site renders the classes on the server.
      await page.getByRole('button', { name: 'Publish changes' }).click();
      await page.getByRole('dialog', { name: 'Publish Contact?' }).getByRole('button', { name: 'Publish changes' }).click();
      await expect(page.getByText('Published. It is live at /contact.')).toBeVisible();
      const html = await (await request.get('http://localhost:4300/contact')).text();
      expect(html).toMatch(/<novan-hero-block[^>]*class="[^"]*\bmt-5\b[^"]*"/);
      expect(html).toMatch(/data-novan-part="heading"[^>]*class="[^"]*\bdisplay-4\b|class="[^"]*\bdisplay-4\b[^"]*"[^>]*data-novan-part="heading"/);    } finally {
      await putBack();
    }
  });
});
