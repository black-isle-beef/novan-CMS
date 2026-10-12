import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ADMIN_CONFIG, AuthService, ViewAs } from '@novan/admin-auth';
import { ManagementApi, SpaceContext } from '@novan/admin-spaces';
import type { SpaceRole } from '@novan/shared-schemas';
import { of } from 'rxjs';
import { AdminShell } from './admin-shell';

const spaceId = '00000000-0000-4000-8000-000000000200';

@Component({ template: '<h1>Screen</h1>' })
class Screen {}

/** The shell with a fake session: `role` in the demo space, or agency staff. */
async function render(role: SpaceRole | null, { agencyStaff = false } = {}) {
  const viewAs = new ViewAs();
  const currentSpaceId = signal<string | null>(null);
  const context = {
    spaces: signal([{ id: spaceId, name: 'Demo site', role }]),
    currentSpaceId,
    currentSpace: computed(() => (currentSpaceId() === spaceId ? { id: spaceId, name: 'Demo site', role } : null)),
    viewingAs: computed(() => viewAs.roleIn(currentSpaceId())),
    currentAccess: computed(() => {
      if (currentSpaceId() !== spaceId) return null;
      const viewed = viewAs.roleIn(spaceId);
      return viewed ? { role: viewed, agencyStaff: false } : { role, agencyStaff };
    }),
    agencyMode: computed(() => role === 'admin' || role === 'developer' || agencyStaff),
    load: vi.fn(() => Promise.resolve()),
    clear: vi.fn(),
  };
  const api = { viewAs: vi.fn(() => of(undefined)) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          path: '',
          component: AdminShell,
          children: [
            { path: 'spaces/:spaceId', component: Screen },
            { path: 'spaces/:spaceId/pages/:entryId/edit', component: Screen, data: { layout: 'wide' } },
            { path: 'account', component: Screen },
          ],
        },
      ]),
      { provide: AuthService, useValue: { agencyStaff: signal(agencyStaff), email: signal('sam.lee@example.com'), signOut: vi.fn() } },
      { provide: SpaceContext, useValue: context },
      { provide: ViewAs, useValue: viewAs },
      { provide: ManagementApi, useValue: api },
      { provide: ADMIN_CONFIG, useValue: { apiUrl: 'http://api.test' } },
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  const harness = await RouterTestingHarness.create(`/spaces/${spaceId}`);
  const el = harness.routeNativeElement?.ownerDocument.querySelector('nv-admin-shell') as HTMLElement;
  // The space menu is in the sidebar; the top bar's navigation has Spaces and Account.
  const menu = () => [...el.querySelectorAll('nav[aria-label="Space"] a')].map((a) => a.textContent?.trim());
  const nav = () => [...el.querySelectorAll('nav[aria-label="Primary"] a')].map((a) => a.textContent?.trim());
  return { harness, el, context, viewAs, api, menu, nav };
}

// jsdom has no modal dialogs; the design system's modal opens one.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

describe('AdminShell', () => {
  it('opens the space\'s search with the Search button or Ctrl+K', async () => {
    const { harness, el } = await render('editor');
    const button = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Search')) as HTMLButtonElement;
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Control+K Meta+K');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true }));
    harness.detectChanges();
    await harness.fixture.whenStable();
    expect(el.querySelector('#nv-search-box')).not.toBeNull();
    expect(document.activeElement?.id).toBe('nv-search-box');
  });

  it('opens the space in the address, and loads the spaces once', async () => {
    const { context } = await render('editor');
    expect(context.currentSpaceId()).toBe(spaceId);
    expect(context.load).toHaveBeenCalledTimes(1);
  });

  it('gives an editor the client menu, in plain language, and no "view as"', async () => {
    const { el, menu } = await render('editor');
    expect(menu()).toEqual(['Dashboard', 'Pages', 'Media', 'Forms', 'Settings']);
    expect(el.querySelector('nav[aria-label="Space"] [aria-current="page"]')?.textContent?.trim()).toBe('Dashboard');
    expect(el.querySelector('nv-view-as-menu')).toBeNull();
  });

  it('keeps the space menu in the sidebar, and Spaces and Account in a compact top bar with the brand', async () => {
    const { el, nav } = await render('editor');
    expect(el.querySelector('ds-sidebar')).not.toBeNull();
    expect(el.querySelector('ds-header')?.classList).toContain('ds-header--app');
    expect(nav()).toEqual(['Spaces', 'Account']);
    const brand = el.querySelector('a.nv-brand') as HTMLAnchorElement;
    expect(brand.getAttribute('aria-label')).toBe('Novan CMS, all spaces');
    expect(brand.getAttribute('href')).toBe('/spaces');
    expect([...brand.querySelectorAll('img')].every((img) => img.getAttribute('alt') === '')).toBe(true);
    // Icons are decorative; the link text names each section.
    expect(el.querySelector('nav[aria-label="Primary"] a i')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('gives wide screens (the visual editor) the whole window, and others the usual column', async () => {
    const { harness, el } = await render('editor');
    const frame = () => el.querySelector('main > div') as HTMLElement;
    expect(frame().classList).toContain('container');
    await harness.navigateByUrl(`/spaces/${spaceId}/pages/x/edit`);
    expect(frame().classList).toContain('container-fluid');
  });

  it('offers Account and Sign out from the account button', async () => {
    const { el } = await render('editor');
    const trigger = el.querySelector('.nv-account-menu button[aria-haspopup="menu"]') as HTMLButtonElement;
    expect(trigger.textContent).toContain('Account and sign out');
    expect(trigger.querySelector('.nv-account-chip')?.textContent?.trim()).toBe('SL');
    expect([...el.querySelectorAll('.nv-account-menu [role="menuitem"]')].map((item) => item.textContent?.trim())).toEqual([
      'Account',
      'Sign out',
    ]);
  });

  it('adds Schema, API tokens and Webhooks for a developer, without the Forms inbox', async () => {
    const { menu } = await render('developer');
    expect(menu()).toEqual(['Dashboard', 'Pages', 'Media', 'Settings', 'Schema', 'API tokens', 'Webhooks']);
  });

  it('leaves keys that are not shortcuts alone, so Tab and typing still work', async () => {
    await render('editor');
    for (const key of ['Tab', 'a', 'Enter']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      document.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it('has no space menu outside a space', async () => {
    const { harness, el } = await render('editor');
    await harness.navigateByUrl('/account');
    expect(el.querySelector('nav[aria-label="Space"]')).toBeNull();
  });

  it('lets agency staff view the space as a role: client menu, a read-only banner, and an audit record', async () => {
    const { harness, el, viewAs, api, menu } = await render(null, { agencyStaff: true });
    expect(el.querySelector('nv-view-as-menu')).not.toBeNull();
    expect(menu()).toContain('Schema');

    viewAs.start(spaceId, 'editor');
    harness.detectChanges();
    expect(menu()).toEqual(['Dashboard', 'Pages', 'Media', 'Forms', 'Settings']);
    const banner = el.querySelector('section[aria-label="Viewing as"]');
    expect(banner?.textContent).toContain('Viewing as Editor.');
    expect(banner?.textContent).toContain('read only');

    ([...(banner?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes('Stop viewing as')) as HTMLButtonElement).click();
    await harness.fixture.whenStable();
    expect(viewAs.current()).toBeNull();
    expect(api.viewAs).toHaveBeenCalledWith(spaceId, null);
    expect(el.querySelector('section[aria-label="Viewing as"]')).toBeNull();
  });
});
