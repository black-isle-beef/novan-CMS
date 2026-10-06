import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ContentApi } from '@novan/admin-content';
import { SpaceContext } from '@novan/admin-spaces';
import type { BlockType, Entry, SignedPreviewToken } from '@novan/shared-schemas';
import { of, throwError } from 'rxjs';
import { EditorApi } from '../editor-api';
import { PreviewBridge } from '../preview-bridge';
import { REFRESH_BEFORE_MS, VisualEditorPage } from './visual-editor-page';

const spaceId = '00000000-0000-4000-8000-000000000200';
const entryId = '00000000-0000-4000-8000-000000000301';
const SITE = 'https://www.example.com';

const entry = (extra: Partial<Entry> = {}): Entry => ({
  id: entryId,
  contentType: 'page',
  contentTypeName: 'Page',
  kind: 'page',
  folderId: null,
  slug: 'home',
  path: '/home',
  locale: 'en-GB',
  title: 'Home',
  status: 'draft',
  hasUnpublishedChanges: false,
  createdAt: '',
  updatedAt: '',
  publishedAt: null,
  deletedAt: null,
  data: { title: 'Home', body: [{ _uid: 'hero-1', _block: 'hero', heading: 'Hi' }] },
  currentVersionId: '00000000-0000-4000-8000-000000000402',
  publishedVersionId: null,
  publishedPath: null,
  ...extra,
});

const hero = { apiId: 'hero', name: 'Hero banner' } as BlockType;
const token = (value: string, minutes = 15): SignedPreviewToken => ({
  token: value,
  expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
});

interface Options {
  page?: Entry;
  previewUrl?: string | null;
  /** The tokens the API hands out in turn, made when asked for; then it fails. */
  tokens?: (() => SignedPreviewToken)[];
}

async function render({ page = entry(), previewUrl = `${SITE}/`, tokens = [() => token('first')] }: Options = {}) {
  const previewToken = vi.fn(() => {
    const next = tokens.shift();
    return next ? of(next()) : throwError(() => new Error('down'));
  });
  TestBed.configureTestingModule({
    imports: [VisualEditorPage],
    providers: [
      provideRouter([]),
      { provide: ContentApi, useValue: { getEntry: () => of(page), listBlockTypes: () => of([hero]) } },
      { provide: EditorApi, useValue: { previewToken } },
      { provide: SpaceContext, useValue: { currentSpaceId: signal(null), currentSpace: signal({ previewUrl }) } },
    ],
  });
  const fixture = TestBed.createComponent(VisualEditorPage);
  fixture.componentRef.setInput('spaceId', spaceId);
  fixture.componentRef.setInput('entryId', entryId);
  await settle(fixture);
  const el = fixture.nativeElement as HTMLElement;
  const bridge = fixture.debugElement.injector.get(PreviewBridge);
  return { fixture, el, bridge, previewToken, frame: () => el.querySelector('iframe') };
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(1);
  else await new Promise((resolve) => setTimeout(resolve));
  await fixture.whenStable();
}

afterEach(() => vi.useRealTimers());

describe('VisualEditorPage', () => {
  it('opens the draft on the site in preview mode, at the home page’s address', async () => {
    const { el, frame } = await render();
    expect(frame()?.getAttribute('src')).toBe(`${SITE}/?novan_preview=first`);
    expect(frame()?.title).toBe('Draft of Home');
    expect(el.querySelector('h1')?.textContent).toBe('Home');
    expect(el.textContent).toContain('Connecting to your site');
  });

  it('opens other pages at their path', async () => {
    const { frame } = await render({ page: entry({ slug: 'about', path: '/company/about' }) });
    expect(frame()?.getAttribute('src')).toBe(`${SITE}/company/about?novan_preview=first`);
  });

  it('changes the screen size', async () => {
    const { fixture, el, frame } = await render();
    expect(frame()?.className).toContain('nv-editor-frame-desktop');
    el.querySelector<HTMLInputElement>('#nv-editor-device-mobile')?.click();
    await settle(fixture);
    expect(frame()?.className).toContain('nv-editor-frame-mobile');
    expect(el.querySelector('label[for="nv-editor-device-mobile"]')?.textContent).toContain('375 pixels wide');
  });

  it('shows the live page only once there is one', async () => {
    const draft = await render();
    const live = draft.el.querySelector<HTMLInputElement>('#nv-editor-view-live');
    expect(live?.disabled).toBe(true);
    expect(live?.getAttribute('aria-describedby')).toBe('nv-editor-live-hint');

    TestBed.resetTestingModule();
    const { fixture, el, frame } = await render({ page: entry({ status: 'published', publishedPath: '/home' }) });
    el.querySelector<HTMLInputElement>('#nv-editor-view-live')?.click();
    await settle(fixture);
    expect(frame()?.getAttribute('src')).toBe(`${SITE}/`);
    expect(frame()?.title).toBe('Live page: Home');

    el.querySelector<HTMLInputElement>('#nv-editor-view-draft')?.click();
    await settle(fixture);
    expect(frame()?.getAttribute('src')).toBe(`${SITE}/?novan_preview=first`);
  });

  it('shows the block clicked on the page by its type’s name', async () => {
    const { fixture, el, bridge } = await render();
    expect(el.querySelector('aside')?.textContent).toContain('Nothing selected');
    bridge.selected.set('hero-1');
    await settle(fixture);
    expect(el.querySelector('aside')?.textContent).toContain('Hero banner');
    // Announced, as the click happened inside the frame.
    expect(el.querySelector('aside [role="status"]')?.textContent).toContain('Hero banner');
  });

  it('renews the token before it expires, through the bridge, without reloading the frame', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { fixture, frame, bridge, previewToken } = await render({ tokens: [() => token('first'), () => token('second')] });
    const send = vi.spyOn(bridge, 'send').mockReturnValue(true);

    await vi.advanceTimersByTimeAsync(15 * 60_000 - REFRESH_BEFORE_MS - 1000);
    expect(previewToken).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(previewToken).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith({ type: 'token', payload: { token: 'second' } });
    fixture.detectChanges();
    expect(frame()?.getAttribute('src')).toBe(`${SITE}/?novan_preview=first`);
  });

  it('says so when the token cannot be renewed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { fixture, el } = await render({ tokens: [() => token('first', 1)] });
    await vi.advanceTimersByTimeAsync(1000);
    fixture.detectChanges();
    expect(el.querySelector('ds-alert')?.textContent).toContain('could not be renewed');
  });

  it('explains what to do when the site has no address', async () => {
    const { el, frame } = await render({ previewUrl: null });
    expect(frame()).toBeNull();
    expect(el.textContent).toContain('once the site');
    expect(el.querySelector(`a[href="/spaces/${spaceId}/content/${entryId}"]`)).not.toBeNull();
  });

  it('refuses a site address that is not http(s)', async () => {
    const { frame } = await render({ previewUrl: 'javascript:alert(1)' });
    expect(frame()).toBeNull();
  });
});
