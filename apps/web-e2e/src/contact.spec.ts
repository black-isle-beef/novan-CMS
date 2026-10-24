import { expect, type Page, test } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { rejectCookies } from './support/consent';
import { waitForHydration } from './support/hydration';

// The site's server sends enquiries on to the Forms feature; these tests answer for the API, so they need no database.
const FORM_ROUTE = '**/_novan/delivery/forms/*/submit';

test.beforeEach(async ({ page }) => {
  await rejectCookies(page);
});

async function fillIn(page: Page): Promise<void> {
  await page.getByLabel('Your name').fill('Sam Example');
  await page.getByLabel('Email address').fill('sam@example.com');
  await page.getByLabel('Company (optional)').fill('Example Ltd');
  await page.getByLabel('Your message').fill('We would like to see the editor.');
  await page.getByLabel(/I agree to Novan Web Services contacting me/).check();
}

test('?enquiry=demo preselects "Book a demo", and the page is accessible', async ({ page }) => {
  await page.goto('/contact?enquiry=demo');
  await waitForHydration(page);
  await expect(page.getByLabel('What is your enquiry about?')).toHaveValue('demo');
  await expect(page.getByRole('link', { name: 'privacy policy', exact: true })).toHaveAttribute('href', '/privacy');
  await expectNoAxeViolations(page);
});

test('sending an empty form lists the problems in a summary that takes focus, and links each to its field', async ({ page }) => {
  await page.goto('/contact');
  await waitForHydration(page);
  await page.getByRole('button', { name: 'Send enquiry' }).click();

  const summary = page.locator('.mk-error-summary');
  await expect(summary).toBeFocused();
  await expect(summary.getByRole('link')).toHaveText([
    'Enter your name',
    'Enter your email address',
    'Enter your message',
    'Tick the box to agree to us contacting you about your enquiry',
  ]);
  const name = page.getByLabel('Your name');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(name).toHaveAccessibleDescription('Error: Enter your name');
  await expectNoAxeViolations(page);

  await summary.getByRole('link', { name: 'Enter your message' }).click();
  await expect(page.getByLabel('Your message')).toBeFocused();
});

test('a sent enquiry goes to the form with every answer and is announced', async ({ page }) => {
  let sent: Record<string, unknown> | null = null;
  await page.route(FORM_ROUTE, async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ status: 202, body: '' });
  });
  await page.goto('/contact?enquiry=sales');
  await waitForHydration(page);
  await fillIn(page);
  await page.getByRole('button', { name: 'Send enquiry' }).click();

  await expect(page.getByRole('status')).toContainText('Thank you. We have your enquiry');
  expect(sent).toEqual({
    entryId: '00000000-0000-4000-8000-00000000c0de',
    locale: 'en-GB',
    website: '',
    data: {
      name: 'Sam Example',
      email: 'sam@example.com',
      company: 'Example Ltd',
      enquiry: 'Sales',
      message: 'We would like to see the editor.',
      consent: true,
    },
  });
  await expect(page.getByLabel('Your name')).toHaveValue('');
});

test("the API's own checks are shown on the fields they concern", async ({ page }) => {
  await page.route(FORM_ROUTE, (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/problem+json',
      body: JSON.stringify({ code: 'form_invalid', title: 'Invalid form', errors: { email: ['Enter a valid email address.'] } }),
    }),
  );
  await page.goto('/contact');
  await waitForHydration(page);
  await fillIn(page);
  await page.getByRole('button', { name: 'Send enquiry' }).click();

  await expect(page.locator('.mk-error-summary')).toBeFocused();
  await expect(page.getByLabel('Email address')).toHaveAccessibleDescription(/Enter a valid email address\./);
});

test('a failure is announced, with the email address to use instead', async ({ page }) => {
  await page.route(FORM_ROUTE, (route) => route.fulfill({ status: 503, body: '' }));
  await page.goto('/contact');
  await waitForHydration(page);
  await fillIn(page);
  await page.getByRole('button', { name: 'Send enquiry' }).click();

  const status = page.getByRole('status');
  await expect(status).toContainText('Sorry, your enquiry could not be sent');
  await expect(status.getByRole('link', { name: 'hello@novan.example' })).toHaveAttribute('href', 'mailto:hello@novan.example');
});
