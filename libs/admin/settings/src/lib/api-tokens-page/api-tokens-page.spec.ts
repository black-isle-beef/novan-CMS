import { HttpErrorResponse } from '@angular/common/http';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SpaceContext } from '@novan/admin-spaces';
import type { ApiToken, CreatedApiToken, SpaceSummary } from '@novan/shared-schemas';
import { of, throwError } from 'rxjs';
import { SettingsApi } from '../settings-api';
import { ApiTokensPage } from './api-tokens-page';

const spaceId = '00000000-0000-4000-8000-000000000200';

const token = (overrides: Partial<ApiToken>): ApiToken => ({
  id: '00000000-0000-4000-8000-000000000301',
  name: 'Main website',
  scope: 'delivery',
  environment: 'main',
  hint: 'nv_del_…a1b2',
  createdBy: null,
  createdByName: 'Novan Admin',
  createdAt: '2026-10-01T09:00:00Z',
  lastUsedAt: null,
  revokedAt: null,
  ...overrides,
});

const website = token({});
const oldPreview = token({
  id: '00000000-0000-4000-8000-000000000302',
  name: 'Old preview',
  scope: 'preview',
  hint: 'nv_pre_…zz99',
  lastUsedAt: '2026-10-02T10:30:00Z',
  revokedAt: '2026-10-03T08:00:00Z',
});

// jsdom has no modal dialogs.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

describe('ApiTokensPage', () => {
  let api: {
    listApiTokens: ReturnType<typeof vi.fn>;
    createApiToken: ReturnType<typeof vi.fn>;
    revokeApiToken: ReturnType<typeof vi.fn>;
  };

  async function render() {
    const spaces = signal<SpaceSummary[] | null>([
      { id: spaceId, name: 'Demo site', slug: 'demo-site', organisationId: spaceId, previewUrl: null, requireApproval: false, role: 'developer', createdAt: '' },
    ]);
    const currentSpaceId = signal<string | null>(null);
    TestBed.configureTestingModule({
      imports: [ApiTokensPage],
      providers: [
        { provide: SettingsApi, useValue: api },
        {
          provide: SpaceContext,
          useValue: {
            spaces,
            currentSpaceId,
            currentSpace: computed(() => spaces()?.find((s) => s.id === currentSpaceId()) ?? null),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(ApiTokensPage);
    fixture.componentRef.setInput('spaceId', spaceId);
    await fixture.whenStable();
    return fixture;
  }

  const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();

  beforeEach(() => {
    api = {
      listApiTokens: vi.fn().mockReturnValue(of([website, oldPreview])),
      createApiToken: vi.fn(),
      revokeApiToken: vi.fn(),
    };
  });

  it('lists tokens in a captioned table with row headers, hints and their state', async () => {
    const el = (await render()).nativeElement as HTMLElement;

    expect(api.listApiTokens).toHaveBeenCalledWith(spaceId);
    expect(text(el.querySelector('caption'))).toBe('API tokens');
    expect([...el.querySelectorAll('tbody th[scope=row]')].map(text)).toEqual(['Main website', 'Old preview']);
    const [first, second] = [...el.querySelectorAll('tbody tr')];
    expect(text(first)).toContain('Delivery');
    expect(text(first)).toContain('nv_del_…a1b2');
    expect(text(first)).toContain('Never');
    expect(text(first?.querySelector('button'))).toBe('Revoke Main website');
    expect(text(second)).toContain('Revoked 3 Oct 2026');
    expect(second?.querySelector('button')).toBeNull();
    expect(el.textContent).toContain('read content from Demo site');
  });

  it('labels the form: the name with its hint, and the type as a fieldset of described radios', async () => {
    const el = (await render()).nativeElement as HTMLElement;

    expect(text(el.querySelector('label[for=token-name]'))).toBe('Name');
    expect(el.querySelector('#token-name')?.getAttribute('aria-describedby')).toBe('token-name-hint');
    expect(text(el.querySelector('fieldset legend'))).toBe('Type');
    expect(el.querySelector('#token-scope-preview')?.getAttribute('aria-describedby')).toBe('token-scope-preview-hint');
    expect(el.querySelector<HTMLInputElement>('#token-scope-delivery')?.checked).toBe(true);
  });

  it('explains a missing name and links the message to the field', async () => {
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;

    el.querySelector('form')?.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    const input = el.querySelector('#token-name');
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(input?.getAttribute('aria-describedby')).toBe('token-name-hint token-name-error');
    expect(text(el.querySelector('#token-name-error'))).toBe('Enter a name for the token.');
    expect(api.createApiToken).not.toHaveBeenCalled();
  });

  it('creates a token, shows its secret once and moves focus to it', async () => {
    const created: CreatedApiToken = {
      ...token({ id: '00000000-0000-4000-8000-000000000303', name: 'Preview server', scope: 'preview', hint: 'nv_pre_…wxyz' }),
      token: 'nv_pre_secretsecretsecretsecretsecretsecretwxyz',
    };
    api.createApiToken.mockReturnValue(of(created));
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;

    const name = el.querySelector<HTMLInputElement>('#token-name')!;
    name.value = ' Preview server ';
    name.dispatchEvent(new Event('input'));
    el.querySelector<HTMLInputElement>('#token-scope-preview')!.click();
    el.querySelector('form')?.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    expect(api.createApiToken).toHaveBeenCalledWith(spaceId, { name: 'Preview server', scope: 'preview' });
    expect(el.querySelector<HTMLInputElement>('#created-token')?.value).toBe(created.token);
    expect(text(el.querySelector('label[for=created-token]'))).toBe('Preview server (preview token)');
    expect(document.activeElement?.id).toBe('created-heading');
    expect(el.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(el.querySelector<HTMLInputElement>('#token-name')?.value).toBe('');
  });

  it('copies the token and says so', async () => {
    const created: CreatedApiToken = { ...website, token: 'nv_del_abc' };
    api.createApiToken.mockReturnValue(of(created));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;
    const name = el.querySelector<HTMLInputElement>('#token-name')!;
    name.value = 'Main website';
    name.dispatchEvent(new Event('input'));
    el.querySelector('form')?.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    [...el.querySelectorAll('button')].find((b) => text(b) === 'Copy token')?.click();
    await fixture.whenStable();

    expect(writeText).toHaveBeenCalledWith('nv_del_abc');
    expect(text(el.querySelector('[role=status]'))).toBe('Copied to the clipboard.');
  });

  it('revokes a token after confirmation', async () => {
    api.revokeApiToken.mockReturnValue(of({ ...website, revokedAt: '2026-10-04T12:00:00Z' }));
    const fixture = await render();
    const el = fixture.nativeElement as HTMLElement;

    el.querySelector<HTMLButtonElement>('tbody tr button')!.click();
    await fixture.whenStable();
    expect(text(el.querySelector('ds-modal'))).toContain('Revoke Main website?');
    [...el.querySelectorAll('ds-modal ds-button')].find((b) => text(b) === 'Revoke token')?.querySelector('button')?.click();
    await fixture.whenStable();

    expect(api.revokeApiToken).toHaveBeenCalledWith(spaceId, website.id);
    expect(text(el.querySelector('ds-alert'))).toContain('Main website is revoked.');
    expect(el.querySelectorAll('tbody tr button')).toHaveLength(0);
  });

  it("shows the API's reason when something fails", async () => {
    api.listApiTokens.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 403, error: { code: 'insufficient_role', detail: 'This needs one of these roles: admin, developer.' } })),
    );
    const el = (await render()).nativeElement as HTMLElement;

    expect(text(el.querySelector('ds-alert'))).toContain('This needs one of these roles: admin, developer.');
    expect(el.querySelector('form')).toBeNull();
  });
});
