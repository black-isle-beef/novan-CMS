import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DsToastService } from '@black-isle-beef/novan-design-system';
import { Confirm } from '@novan/admin-shell';
import { SpaceContext } from '@novan/admin-spaces';
import type { CreateRedirectRequest, Redirect } from '@novan/shared-schemas';
import { of, throwError } from 'rxjs';
import { SettingsApi } from '../settings-api';
import { RedirectsPage } from './redirects-page';

const spaceId = '00000000-0000-4000-8000-000000000200';

const redirect = (fromPath: string, toPath: string, extra: Partial<Redirect> = {}): Redirect => ({
  id: `id-${fromPath}`,
  fromPath,
  toPath,
  status: 301,
  automatic: false,
  createdBy: 'u',
  createdByName: 'Ada',
  createdAt: '',
  updatedAt: '',
  ...extra,
});

async function render(options: { canChange?: boolean; from?: string; create?: () => ReturnType<typeof of> } = {}) {
  const api = {
    listRedirects: vi.fn(() => of([redirect('/old-about', '/about'), redirect('/about-us', '/about', { automatic: true, createdBy: null, createdByName: null })])),
    createRedirect: vi.fn(options.create ?? ((_s: string, body: CreateRedirectRequest) => of(redirect(body.fromPath, body.toPath, { status: body.status ?? 301 })))),
    updateRedirect: vi.fn((_s: string, id: string, body: Partial<Redirect>) => of({ ...redirect('/old-about', '/about'), id, ...body })),
    deleteRedirect: vi.fn(() => of(undefined)),
    importRedirects: vi.fn(() => of({ created: 1, updated: 1, skipped: [{ fromPath: '/about', message: 'A published page has this address.' }] })),
  };
  const confirm = { ask: vi.fn(() => Promise.resolve(true)) };
  const toasts = { success: vi.fn() };
  TestBed.configureTestingModule({
    imports: [RedirectsPage],
    providers: [
      provideRouter([]),
      { provide: SettingsApi, useValue: api },
      { provide: Confirm, useValue: confirm },
      { provide: DsToastService, useValue: toasts },
      { provide: SpaceContext, useValue: { currentSpaceId: signal(null), canPublishCurrent: signal(options.canChange ?? true) } },
    ],
  });
  const fixture = TestBed.createComponent(RedirectsPage);
  fixture.componentRef.setInput('spaceId', spaceId);
  if (options.from) fixture.componentRef.setInput('from', options.from);
  await settle(fixture);
  const el = fixture.nativeElement as HTMLElement;
  const button = (name: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.replace(/\s+/g, ' ').trim() === name);
  const fill = async (id: string, value: string) => {
    const input = el.querySelector<HTMLInputElement>(`#${id}`);
    input!.value = value;
    input!.dispatchEvent(new Event('input'));
    await settle(fixture);
  };
  const rows = () => [...el.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('td')].slice(0, 4).map((cell) => cell.textContent?.trim()));
  return { fixture, el, api, confirm, toasts, button, fill, rows };
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
}

describe('RedirectsPage', () => {
  it('lists the redirects, marking those the CMS made', async () => {
    const { rows } = await render();

    expect(rows()).toEqual([
      ['/about-us', '/about', 'Permanent', 'Automatic, when the page moved'],
      ['/old-about', '/about', 'Permanent', 'Ada'],
    ]);
  });

  it('adds a redirect, with the address from the missing pages screen filled in', async () => {
    const { fixture, el, api, fill, rows, toasts } = await render({ from: '/gone' });
    expect(el.querySelector<HTMLInputElement>('#redirect-from')?.value).toBe('/gone');
    await fill('redirect-to', '/about');
    el.querySelector<HTMLInputElement>('#redirect-status-302')?.click();

    el.querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle(fixture);

    expect(api.createRedirect).toHaveBeenCalledWith(spaceId, { fromPath: '/gone', toPath: '/about', status: 302 });
    expect(rows()[1]).toEqual(['/gone', '/about', 'Temporary', 'Ada']);
    expect(toasts.success).toHaveBeenCalledWith('/gone now redirects to /about.');
  });

  it('shows mistakes in the API’s words, next to the field', async () => {
    const { fixture, el, api, fill } = await render();
    await fill('redirect-from', 'old');
    await fill('redirect-to', 'javascript:alert(1)');

    el.querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle(fixture);

    expect(api.createRedirect).not.toHaveBeenCalled();
    expect(el.querySelector('#redirect-from-hint')?.textContent).toContain('starting with /');
    expect(el.querySelector('#redirect-to')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('says when the API refuses, such as a published page at that address', async () => {
    const refusal = new HttpErrorResponse({ status: 409, error: { code: 'redirect_hides_page', detail: 'A published page is at /about.' } });
    const { fixture, el, fill } = await render({ create: () => throwError(() => refusal) });
    await fill('redirect-from', '/about');
    await fill('redirect-to', '/');

    el.querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle(fixture);

    expect(el.textContent).toContain('A published page is at /about.');
  });

  it('changes and deletes a redirect, after asking', async () => {
    const { fixture, el, api, confirm, button, fill, rows } = await render();
    button('Change the redirect from /old-about')?.click();
    await settle(fixture);
    await fill('redirect-to', '/company/about');
    el.querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(api.updateRedirect).toHaveBeenCalledWith(spaceId, 'id-/old-about', { fromPath: '/old-about', toPath: '/company/about', status: 301 });

    button('Delete the redirect from /about-us')?.click();
    await settle(fixture);
    expect(confirm.ask).toHaveBeenCalledWith(expect.objectContaining({ heading: 'Delete the redirect from /about-us?', destructive: true }));
    expect(api.deleteRedirect).toHaveBeenCalledWith(spaceId, 'id-/about-us');
    expect(rows().map((row) => row[0])).toEqual(['/old-about']);
  });

  it('finds addresses', async () => {
    const { fixture, fill, rows } = await render();
    await fill('redirects-search', 'us');
    await settle(fixture);

    expect(rows().map((row) => row[0])).toEqual(['/about-us']);
  });

  it('imports a CSV file after showing what will be imported and what cannot be', async () => {
    const { fixture, el, api, button } = await render();
    const input = el.querySelector<HTMLInputElement>('#redirects-file') as HTMLInputElement;
    const csv = 'from,to\n/a,/about\nnot-a-path,/x\n/b,/about,302\n';
    const file = new File([csv], 'old-site.csv', { type: 'text/csv' });
    // jsdom's File has no text(); browsers' does.
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(csv) });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve));
    await settle(fixture);

    const preview = el.querySelector('#redirects-import-preview');
    expect(preview?.textContent).toContain('2 redirects ready to import');
    expect(preview?.textContent).toContain('Line 3:');

    button('Import 2 redirects')?.click();
    await settle(fixture);
    expect(api.importRedirects).toHaveBeenCalledWith(spaceId, {
      redirects: [
        { fromPath: '/a', toPath: '/about', status: 301 },
        { fromPath: '/b', toPath: '/about', status: 302 },
      ],
    });
    expect(el.querySelector('#redirects-import-result')?.textContent).toContain('1 added, 1 changed, 1 left out');
  });

  it('lets roles that cannot change redirects only look', async () => {
    const { el, button } = await render({ canChange: false });

    expect(el.querySelector('form')).toBeNull();
    expect(el.querySelector('#redirects-file')).toBeNull();
    expect(button('Download all redirects as CSV')).toBeDefined();
  });
});
