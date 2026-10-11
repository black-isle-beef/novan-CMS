import { expect, type Page, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { expectNoAxeViolations } from './support/axe';
import { waitForHydration } from './support/hydration';
import { anonKey, management } from './support/management';

// Forms (docs/build/18-search-forms-audit.md): a visitor sends the seeded contact form, it reaches the Forms inbox,
// and the space's recipient gets an email (Mailpit, local Supabase's inbox; the API's worker sends it). They write
// submissions and publish a page, so they run in their own project after the read-only tests (playwright.config.mts).
// Locally there is no Turnstile key, so the API accepts forms without the check (unit tests cover Turnstile).

const mailpit = process.env['MAILPIT_URL'] || 'http://127.0.0.1:54324';
/** The contact page's form (supabase/seed.sql). */
const contactForm = '00000000-0000-4000-8000-000000000924';

interface MailpitSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

/** Fills in the contact form as a visitor would. */
async function fillContactForm(page: Page, message: string): Promise<void> {
  const form = page.locator('novan-form-block');
  await form.getByRole('textbox', { name: /^Your name/ }).fill('Ada Lovelace');
  await form.getByRole('textbox', { name: /^Email address/ }).fill('ada@example.com');
  await form.getByRole('combobox', { name: 'What is it about?' }).selectOption('A new site');
  await form.getByRole('textbox', { name: /^Message/ }).fill(message);
  await form.getByRole('checkbox', { name: /^I agree that you may keep my message/ }).check();
}

const formBlock = (tone: string) => ({
  _uid: randomUUID(),
  _block: 'form',
  _style: { tone },
  heading: `A ${tone} form`,
  intro: 'Every tone, with its problems showing.',
  fields: [
    { label: 'Your name', name: 'name', type: 'text', required: true, help: 'As you would like us to write it.' },
    { label: 'Email address', name: 'email', type: 'email', required: true },
    { label: 'I agree', name: 'consent', type: 'consent', required: true },
  ],
  submitLabel: 'Send',
  successMessage: 'Thank you.',
});

test.describe('@forms', () => {
  test.skip(!anonKey, 'needs SUPABASE_ANON_KEY (.env.local)');

  test('a visitor sends the contact form; it appears in the inbox and the recipients get an email', async ({ page, request }) => {
    const marker = `e2e-${Date.now()}-${test.info().project.name}`;
    await page.goto('/contact');
    await waitForHydration(page);
    const form = page.locator('novan-form-block');

    // Problems first: listed in a summary that takes focus, each linked to its field.
    await form.getByRole('button', { name: 'Send message' }).click();
    const summary = form.locator('.novan-form-block__summary');
    await expect(summary).toBeFocused();
    await expect(summary.getByRole('link')).toHaveText(['Fill in this field.', 'Fill in this field.', 'Fill in this field.', 'Tick this box to send the form.']);
    await expect(form.getByRole('textbox', { name: /^Your name/ })).toHaveAttribute('aria-invalid', 'true');
    await expectNoAxeViolations(page);
    await summary.getByRole('link').first().click();
    await expect(form.getByRole('textbox', { name: /^Your name/ })).toBeFocused();

    await fillContactForm(page, `Hello from ${marker}`);
    await form.getByRole('button', { name: 'Send message' }).click();
    const thanks = form.getByRole('status');
    await expect(thanks).toHaveText('Thank you. Your message has been sent, and we will reply by email.');
    await expect(thanks).toBeFocused();
    await expectNoAxeViolations(page);

    // In the inbox, as an editor sees it.
    const api = await management(request);
    const inbox = await api.get(`/forms/submissions?form=${contactForm}`);
    const kept = inbox.items.find((item: { data: Record<string, unknown> }) => item.data['message'] === `Hello from ${marker}`);
    expect(kept).toMatchObject({
      formName: 'Send us a message',
      pagePath: '/contact',
      data: { name: 'Ada Lovelace', email: 'ada@example.com', topic: 'A new site', newsletter: false, consent: true },
    });

    // The worker emails the space's recipients (forms@example.com in the seed).
    await expect
      .poll(
        async () => {
          const search = await request.get(`${mailpit}/api/v1/search`, { params: { query: marker } });
          const { messages } = (await search.json()) as { messages: MailpitSummary[] };
          return messages.map((message) => `${message.Subject} -> ${message.To.map((to) => to.Address).join(', ')}`);
        },
        { timeout: 30_000 },
      )
      .toEqual(['New message from Send us a message on Demo site -> forms@example.com']);
  });

  test('the form is readable in every tone, with its problems showing', async ({ page, request }) => {
    const api = await management(request);
    const slug = `form-tones-${Date.now()}-${test.info().project.name}`;
    const id = await api.publishNewPage({ title: 'Form tones', slug, body: ['light', 'brand', 'dark'].map(formBlock) });
    try {
      await page.goto(`/${slug}`);
      await waitForHydration(page);
      for (const form of await page.locator('novan-form-block').all()) {
        await form.getByRole('button', { name: 'Send' }).click();
        await expect(form.locator('.novan-form-block__summary [role="alert"]')).toBeVisible();
      }
      await expect(page.locator('[aria-invalid="true"]')).toHaveCount(9);
      await expectNoAxeViolations(page);
    } finally {
      await api.remove(id);
    }
  });
});
