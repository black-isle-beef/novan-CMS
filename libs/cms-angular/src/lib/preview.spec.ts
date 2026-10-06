import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, PLATFORM_ID, type Provider, REQUEST, RESPONSE_INIT, signal, TransferState } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { defineBlocks } from './blocks';
import { NOVAN_BRIDGE_LOADER, type NovanBridgeHost, type NovanServerOptions } from './config';
import { NovanContentService } from './content.service';
import { CMS_ANGULAR_VERSION } from './package-info';
import { NovanPreview } from './preview';
import { provideNovanCms, provideNovanCmsServer } from './provide';
import type { Page } from './types';

const ADMIN = 'https://admin.novan.test';
const entryId = '00000000-0000-4000-8000-000000000101';
const session = { entryId, expiresAt: '2026-10-06T12:15:00.000Z', adminOrigin: ADMIN };
const page: Page = { id: entryId, contentType: 'page', path: '/about', locale: 'en-GB', updatedAt: '', data: { title: 'About' } };
const previewUrl = 'http://site.test/about?novan_preview=signed-by-admin';
const STATE_ID = 'a-state';

/** Lets promises settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve));

function serverSetup(verifyPreview: NovanServerOptions['verifyPreview'], response: ResponseInit = {}) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: PLATFORM_ID, useValue: 'server' },
      { provide: REQUEST, useValue: new Request(previewUrl) },
      { provide: RESPONSE_INIT, useValue: response },
      provideNovanCms({ blocks: defineBlocks({}) }),
      provideNovanCmsServer({ apiUrl: 'http://api.test', deliveryToken: 'nv_del_x', previewToken: 'nv_pre_x', verifyPreview }),
    ],
  });
  return TestBed.inject(NovanPreview);
}

/** A preview page in the browser, as the server rendered it, optionally inside the admin's frame. */
function browserSetup(state: unknown, { framed = true } = {}) {
  const script = document.createElement('script');
  script.id = STATE_ID;
  script.type = 'application/json';
  script.textContent = JSON.stringify({ 'novan:preview': state });
  document.body.appendChild(script);
  window.history.replaceState(null, '', '/about?novan_preview=signed-by-admin');
  if (framed) vi.spyOn(window, 'parent', 'get').mockReturnValue({} as Window);

  const handle = { navigated: vi.fn(), stop: vi.fn() };
  const startNovanBridge = vi.fn<(host: NovanBridgeHost) => typeof handle>(() => handle);
  const loader = vi.fn(() => Promise.resolve({ startNovanBridge }));
  const providers: Provider[] = [{ provide: PLATFORM_ID, useValue: 'browser' }, { provide: NOVAN_BRIDGE_LOADER, useValue: loader }];
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([{ path: '**', children: [] }]),
      ...providers,
      provideNovanCms({ blocks: defineBlocks({}) }),
    ],
  });
  const preview = TestBed.inject(NovanPreview);
  const host = () => startNovanBridge.mock.calls[0]?.[0] as NovanBridgeHost;
  return { preview, loader, startNovanBridge, handle, host };
}

afterEach(() => {
  document.getElementById(STATE_ID)?.remove();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('NovanPreview on the server', () => {
  it('keeps the editor session and lets only the admin frame the page', async () => {
    const response: ResponseInit = {};
    const preview = serverSetup(() => Promise.resolve(session), response);
    expect(await preview.resolve()).toBe(true);
    expect(preview.session()).toEqual({ entryId, adminOrigin: ADMIN });

    const headers = new Headers(response.headers);
    expect(headers.get('Cache-Control')).toBe('private, no-store');
    expect(headers.get('Content-Security-Policy')).toBe(`frame-ancestors 'self' ${ADMIN}`);
    // The browser gets the session, not the token.
    const json = TestBed.inject(TransferState).toJson();
    expect(JSON.parse(json)).toEqual({ 'novan:preview': { active: true, session: { entryId, adminOrigin: ADMIN } } });
    expect(json).not.toContain('signed-by-admin');
  });

  it('allows only its own origin to frame a preview opened outside the editor', async () => {
    const response: ResponseInit = {};
    expect(await serverSetup(() => true, response).resolve()).toBe(true);
    expect(new Headers(response.headers).get('Content-Security-Policy')).toBe("frame-ancestors 'self'");
  });

  it.each([
    ['an origin that is not a web address', { ...session, adminOrigin: 'javascript:alert(1)' }],
    ['an origin that cannot be read', { ...session, adminOrigin: 'not a url' }],
    ['a session without a page', { adminOrigin: ADMIN } as unknown as typeof session],
  ])('stays off for %s', async (_, answer) => {
    const preview = serverSetup(() => answer);
    expect(await preview.resolve()).toBe(false);
    expect(preview.session()).toBeNull();
  });

  it('keeps only the origin of the admin address', async () => {
    const preview = serverSetup(() => ({ ...session, adminOrigin: `${ADMIN}/some/path` }));
    await preview.resolve();
    expect(preview.session()?.adminOrigin).toBe(ADMIN);
  });
});

describe('NovanPreview in the browser', () => {
  it('starts the bridge for the admin in the editor frame', async () => {
    const { loader, startNovanBridge, host } = browserSetup({ active: true, session: { entryId, adminOrigin: ADMIN } });
    await settle();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(startNovanBridge).toHaveBeenCalledTimes(1);
    expect(host()).toMatchObject({ adminOrigin: ADMIN, sdkVersion: CMS_ANGULAR_VERSION });
  });

  it('tells the bridge when the site navigates', async () => {
    const { handle } = browserSetup({ active: true, session: { entryId, adminOrigin: ADMIN } });
    await settle();
    await TestBed.inject(Router).navigateByUrl('/contact');
    TestBed.tick();
    expect(handle.navigated).toHaveBeenCalled();
  });

  it('does not load the bridge outside a frame, or without a session', async () => {
    for (const [state, framed] of [
      [{ active: true, session: { entryId, adminOrigin: ADMIN } }, false],
      [{ active: true, session: null }, true],
      [true, true],
      [{ active: false, session: null }, true],
    ] as const) {
      TestBed.resetTestingModule();
      document.getElementById(STATE_ID)?.remove();
      vi.restoreAllMocks();
      const { loader } = browserSetup(state, { framed });
      await settle();
      expect(loader).not.toHaveBeenCalled();
    }
  });

  it('shows the editor’s data for the page being edited, and only that page', async () => {
    const { preview, host } = browserSetup({ active: true, session: { entryId, adminOrigin: ADMIN } });
    await settle();
    const current = signal<Page | null>(page);
    const shown = computed(() => preview.withLiveData(current()));
    expect(shown()).toBe(page);

    host().update({ title: 'About (edited)', body: [] });
    expect(shown()).toEqual({ ...page, data: { title: 'About (edited)', body: [] } });

    current.set({ ...page, id: '00000000-0000-4000-8000-000000000999' });
    expect(shown()?.data).toEqual({ title: 'About' });
    expect(preview.withLiveData(null)).toBeNull();
  });

  it('sends the admin’s refreshed token with later requests', async () => {
    const { host } = browserSetup({ active: true, session: { entryId, adminOrigin: ADMIN } });
    await settle();
    host().token('refreshed-token');

    const content = TestBed.inject(NovanContentService);
    const result = firstValueFrom(content.page('/contact'));
    await settle();
    const req = TestBed.inject(HttpTestingController).expectOne((r) => r.url === '/_novan/preview/pages');
    expect(req.request.headers.get('X-Novan-Preview')).toBe('refreshed-token');
    req.flush(page);
    await result;
  });
});
