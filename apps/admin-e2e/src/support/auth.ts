import { expect, type Page } from '@playwright/test';
import { TOTP } from 'otpauth';

/** Seeded local users (supabase/seed.sql). */
export const agency = { email: 'agency@novan.test', password: 'password123' };
export const client = { email: 'client@novan.test', password: 'password123' };

/** The seeded agency user's TOTP secret (supabase/seed.sql). */
const agencyTotp = new TOTP({ secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', digits: 6, period: 30 });

const mailpitUrl = process.env['MAILPIT_URL'] ?? 'http://127.0.0.1:54324';

export async function signIn(page: Page, user: { email: string; password: string }): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/** Signs the agency user in and completes two-step verification with the seeded authenticator. */
export async function signInAsAgency(page: Page): Promise<void> {
  await signIn(page, agency);
  await expect(page.getByRole('heading', { level: 1, name: 'Two-step verification' })).toBeVisible();
  await page.getByLabel('6-digit code').fill(agencyTotp.generate());
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Spaces' })).toBeVisible();
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
}

/** Waits for the newest email to `to` in the local Mailpit inbox and returns its first Supabase Auth link. */
export async function authLinkFromEmail(to: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const search = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
        const { messages } = (await search.json()) as { messages: { ID: string }[] };
        if (!messages.length) return undefined;
        const message = await fetch(`${mailpitUrl}/api/v1/message/${messages[0].ID}`);
        const { HTML } = (await message.json()) as { HTML: string };
        link = HTML.match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/)?.[1]?.replace(/&amp;/g, '&');
        return link;
      },
      { message: `an auth email to ${to}`, timeout: 15_000 },
    )
    .toBeTruthy();
  return link as string;
}
