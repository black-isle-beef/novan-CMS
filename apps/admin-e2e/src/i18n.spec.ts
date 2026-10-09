import { expect, test } from '@playwright/test';
import { signIn, spaceAdmin } from './support/auth';
import { expectNoAxeViolations } from './support/axe';
import { keepPublished, removeLocale } from './support/management';

// Localisation (docs/build/16-localisation.md), as the demo space's admin: add French, translate the home page side
// by side, publish, and see the site serve it at /fr while an untranslated page falls back to English. Needs local
// Supabase (`npm run db:start && npm run db:reset`); the API, admin and starter site start automatically. The space
// is put back to English only afterwards, as the other journeys expect it.

const space = '00000000-0000-4000-8000-000000000200';
const home = '00000000-0000-4000-8000-000000000701';
const site = 'http://localhost:4300';

test.describe('@i18n', () => {
  test('an admin adds French, translates the home page, and untranslated pages fall back to English', async ({ page, request }) => {
    test.setTimeout(120_000);
    const putBack = await keepPublished(request, space, home);
    try {
      await signIn(page, spaceAdmin);
      await page.getByRole('link', { name: 'Demo site' }).click();
      await page.getByRole('navigation', { name: 'Space' }).getByRole('link', { name: 'Settings', exact: true }).click();
      await page.getByRole('link', { name: 'Languages' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Languages' })).toBeVisible();
      await expect(page).toHaveTitle('Languages | Novan CMS');

      // French, falling back to English, at /fr addresses.
      await page.getByLabel('Language code').fill('fr-FR');
      await expect(page.getByLabel('Name')).toHaveValue('French (France)');
      await expect(page.getByLabel('Address prefix')).toHaveValue('fr');
      await expect(page.getByLabel('Untranslated text comes from')).toHaveValue('en-GB');
      await expectNoAxeViolations(page);
      await page.getByRole('button', { name: 'Add language' }).click();
      const french = page.getByRole('row').filter({ hasText: 'French (France)' });
      await expect(french).toContainText('English (UK)');
      await page.getByLabel('Start addresses with the language').check();
      await expect(french).toContainText('/fr/about');
      await expectNoAxeViolations(page);

      // Every page now says it needs translating.
      await page.getByRole('navigation', { name: 'Space' }).getByRole('link', { name: 'Pages' }).click();
      const homeRow = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Home', exact: true }) });
      await expect(homeRow).toContainText('Needs translation: French (France)');
      await expectNoAxeViolations(page);

      // Translate the home page with the English text alongside.
      await homeRow.getByRole('link', { name: 'Home', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
      await page.getByLabel('Language').selectOption({ label: 'French (France) (needs translation)' });
      await page.getByLabel('Show English (UK) alongside').check();
      await expect(page.getByRole('textbox', { name: 'Title (English (UK)) (required)' })).toBeDisabled();
      await expect(page.getByRole('textbox', { name: 'Title (English (UK)) (required)' })).toHaveValue('Home');
      await expect(page.getByRole('textbox', { name: 'Slug' })).toBeDisabled();
      await page.getByRole('textbox', { name: 'Title (French (France))', exact: true }).fill('Accueil');
      await page.getByRole('button', { name: 'Edit Hero block 1' }).click();
      const hero = page.getByRole('region', { name: 'Hero block 1' });
      await hero.getByRole('textbox', { name: 'Heading (French (France))', exact: true }).fill('Bienvenue sur le site de démonstration');
      await expectNoAxeViolations(page);

      await page.getByRole('button', { name: 'Publish changes' }).click();
      await page.getByRole('dialog', { name: /^Publish / }).getByRole('button', { name: /^Publish/ }).click();
      await expect(page.getByText(/^Published\./)).toBeVisible();

      // The site serves the translation at /fr, says so, and links the English version.
      await page.goto(`${site}/fr`);
      await expect(page.getByRole('heading', { level: 1, name: 'Bienvenue sur le site de démonstration' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'fr-FR');
      await expect(page.locator('link[rel="alternate"][hreflang="en-GB"]')).toHaveAttribute('href', /\/$/);
      await expect(page.locator('link[rel="alternate"][hreflang="fr-FR"]')).toHaveAttribute('href', /\/fr$/);

      // The about page has no French yet: it shows the English text, in the French part of the site.
      const about = await page.goto(`${site}/fr/about`);
      expect(about?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1, name: 'About this site' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'fr-FR');

      // English is where it was.
      await page.goto(`${site}/`);
      await expect(page.getByRole('heading', { level: 1, name: 'Welcome to the Novan demo site' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
    } finally {
      await putBack();
      await removeLocale(request, space, 'fr-FR');
    }
  });
});
