import { expect, test } from '@playwright/test';
import { signIn, spaceAdmin } from './support/auth';
import { expectNoAxeViolations } from './support/axe';

// Approving a sign-in from the Novan CLI (docs/build/19-schema-cli-starter-kits.md). The test plays the CLI with the
// API's device routes, and the person in the admin.

const apiUrl = process.env['API_URL'] ?? 'http://localhost:3000';

interface Started {
  deviceCode: string;
  userCode: string;
  verificationUriComplete: string;
}

test.describe('@device', () => {
  test('a person approves the code the CLI shows, and the CLI gets its sign-in', async ({ page, request }) => {
    const started = (await (await request.post(`${apiUrl}/v1/auth/device-authorizations`, { data: { clientName: 'Novan CLI on e2e' } })).json()) as Started;
    const poll = () => request.post(`${apiUrl}/v1/auth/device-authorizations/token`, { data: { deviceCode: started.deviceCode } });
    expect((await (await poll()).json()).code).toBe('authorization_pending');

    // The link the CLI opens: sign in first, then land on the approval page with the code filled in.
    await page.goto(new URL(started.verificationUriComplete).pathname + new URL(started.verificationUriComplete).search);
    // Signed in from the page it redirected to (not the signIn helper, which opens /sign-in afresh), so the admin
    // returns to the approval page.
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await page.getByLabel('Email').fill(spaceAdmin.email);
    await page.getByLabel('Password').fill(spaceAdmin.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in to the Novan CLI' })).toBeVisible();
    await expect(page).toHaveTitle('Sign in to the Novan CLI | Novan CMS');
    await expect(page.getByLabel('Code from your terminal')).toHaveValue(started.userCode);
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: 'Approve sign-in' }).click();
    await expect(page.getByText(`The CLI is signed in as ${spaceAdmin.email}.`)).toBeVisible();
    await expectNoAxeViolations(page);

    const token = await poll();
    expect(token.status()).toBe(200);
    expect(await token.json()).toMatchObject({ email: spaceAdmin.email, tokenHash: expect.any(String) });
  });

  test('a typed code that is not right is refused, and a denied code gives the CLI nothing', async ({ page, request }) => {
    const started = (await (await request.post(`${apiUrl}/v1/auth/device-authorizations`, { data: { clientName: 'Novan CLI on e2e' } })).json()) as Started;
    await signIn(page, spaceAdmin);
    await expect(page.getByRole('heading', { level: 1, name: 'Spaces' })).toBeVisible();
    await page.goto('/device');

    const code = page.getByLabel('Code from your terminal');
    await code.fill('ABC');
    await page.getByRole('button', { name: 'Approve sign-in' }).click();
    await expect(code).toHaveAttribute('aria-invalid', 'true');
    await expect(code).toHaveAccessibleDescription('Eight letters, like BCDF-GHJK.');
    await expectNoAxeViolations(page);

    await code.fill('BBBB-BBBB');
    await page.getByRole('button', { name: 'Approve sign-in' }).click();
    await expect(page.getByText('This code is not right, has expired or was already used.')).toBeVisible();

    await code.fill(started.userCode.toLowerCase());
    await page.getByRole('button', { name: 'Deny' }).click();
    await expect(page.getByText('Sign-in denied.')).toBeVisible();

    const token = await request.post(`${apiUrl}/v1/auth/device-authorizations/token`, { data: { deviceCode: started.deviceCode } });
    expect((await token.json()).code).toBe('access_denied');
  });
});
