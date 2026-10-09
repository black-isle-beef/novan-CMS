import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '@novan/admin-auth';
import { ContentApi } from '@novan/admin-content';
import { MediaApi, Thumbnails } from '@novan/admin-media';
import { ManagementApi, SpaceContext } from '@novan/admin-spaces';
import {
  type BlockNode,
  type BlockType,
  type ContentType,
  type Entry,
  type EntryData,
  fieldListSchema,
  type SignedPreviewToken,
} from '@novan/shared-schemas';
import { of, throwError } from 'rxjs';
import { EditorApi } from '../editor-api';
import { EditorStore } from '../editor-store';
import { PreviewBridge } from '../preview-bridge';
import type { PresenceState } from '../presence/presence';
import { PRESENCE_TRANSPORT, type PresenceTransport } from '../presence/presence-transport';
import { AUTOSAVE_EVERY_MS, PREVIEW_DEBOUNCE_MS, READY_TIMEOUT_MS, REFRESH_BEFORE_MS, VisualEditorPage } from './visual-editor-page';

/** Presence that the tests drive: who else is on the page, and what this tab last said. */
function fakePresence() {
  let sync: ((states: PresenceState[]) => void) | null = null;
  const tracked: PresenceState[] = [];
  const transport: PresenceTransport = {
    join: (_topic, _key, onSync) => {
      sync = onSync;
      return { track: (state) => tracked.push(state), leave: () => (sync = null) };
    },
  };
  const someone = (extra: Partial<PresenceState> = {}): PresenceState => ({
    session: 'their-tab',
    userId: 'them',
    name: 'Ada Lovelace',
    editing: false,
    since: null,
    at: new Date().toISOString(),
    ...extra,
  });
  return {
    transport,
    tracked,
    someone,
    /** Everyone on the page now, besides this tab. */
    others: (...states: PresenceState[]) => sync?.([...states, ...tracked.slice(-1)]),
  };
}

const spaceId = '00000000-0000-4000-8000-000000000200';
const entryId = '00000000-0000-4000-8000-000000000301';
const SITE = 'https://www.example.com';
const HERO = '00000000-0000-4000-8000-000000000901';
const CTA = '00000000-0000-4000-8000-000000000902';
const SETTINGS = '00000000-0000-4000-8000-000000000712';

const pageType: ContentType = {
  id: 't',
  spaceId,
  environmentId: 'e',
  apiId: 'page',
  name: 'Page',
  kind: 'page',
  description: null,
  fields: fieldListSchema.parse([
    { id: 'title', apiId: 'title', label: 'Title', type: 'text', required: true },
    { id: 'body', apiId: 'body', label: 'Content', type: 'blocks', allowedBlocks: ['hero', 'cta', 'columns'] },
  ]),
  createdAt: '',
  updatedAt: '',
};

const blockType = (apiId: string, name: string, extra: Partial<BlockType> = {}): BlockType =>
  ({
    id: apiId,
    spaceId,
    environmentId: 'e',
    apiId,
    name,
    icon: null,
    previewImagePath: null,
    fields: fieldListSchema.parse([{ id: 'heading', apiId: 'heading', label: 'Heading', type: 'text', required: true }]),
    allowedChildren: [],
    styleOptions: {},
    schemaVersion: 1,
    createdAt: '',
    updatedAt: '',
    ...extra,
  }) as BlockType;

const blockTypes = [
  blockType('hero', 'Hero banner', {
    styleOptions: {
      tone: { kind: 'radio', label: 'Tone', default: 'brand', options: [{ value: 'light', label: 'Light' }, { value: 'brand', label: 'Brand' }] },
    },
  }),
  blockType('cta', 'Call to action'),
  blockType('columns', 'Columns', { fields: [], allowedChildren: ['cta'] }),
];

const startData = (): EntryData => ({
  title: 'Home',
  body: [
    { _uid: HERO, _block: 'hero', heading: 'Hi' },
    { _uid: CTA, _block: 'cta', heading: 'Call us' },
  ],
});

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
  data: startData(),
  currentVersionId: '00000000-0000-4000-8000-000000000402',
  publishedVersionId: null,
  publishedPath: null,
  ...extra,
});

const token = (value: string, minutes = 15): SignedPreviewToken => ({
  token: value,
  expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
});

interface Options {
  page?: Entry;
  previewUrl?: string | null;
  role?: 'editor' | 'author' | 'viewer';
  /** The tokens the API hands out in turn, made when asked for; then it fails. */
  tokens?: (() => SignedPreviewToken)[];
  type?: ContentType;
  /** The space's site settings, for the SEO tab's previews. */
  settings?: EntryData;
}

// jsdom has no modal dialogs.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

async function render({ page = entry(), previewUrl = `${SITE}/`, role = 'editor', tokens = [() => token('first')], type = pageType, settings }: Options = {}) {
  const presence = fakePresence();
  const previewToken = vi.fn(() => {
    const next = tokens.shift();
    return next ? of(next()) : throwError(() => new Error('down'));
  });
  const previewData = vi.fn((_s: string, _e: string, data: EntryData) => of({ id: entryId, contentType: 'page', path: '/', locale: 'en-GB', updatedAt: '', data: { ...data, delivered: true } }));
  const content = {
    getEntry: vi.fn((_s: string, id: string) => (id === SETTINGS ? of(entry({ id: SETTINGS, contentType: 'siteSettings', data: settings ?? {} })) : of(page))),
    listContentTypes: vi.fn(() => of([type])),
    listBlockTypes: vi.fn(() => of(blockTypes)),
    listEntries: vi.fn(() => of(settings ? [{ ...entry({ id: SETTINGS, contentType: 'siteSettings' }), title: 'Site settings' }] : [])),
    saveEntry: vi.fn((_s: string, _id: string, data: EntryData) => of(entry({ data }))),
    autosaveEntry: vi.fn((_s: string, _id: string, data: EntryData) => of(entry({ data }))),
    publish: vi.fn(() => of(entry({ status: 'published', publishedPath: '/home', publishedVersionId: 'v' }))),
    workflow: vi.fn(() =>
      of({ state: 'draft', requireApproval: false, live: false, actions: role === 'editor' ? ['edit', 'publish', 'archive'] : ['edit'], review: null }),
    ),
    references: vi.fn(() => of([])),
    diff: vi.fn(() => of({ from: 'a', to: 'b', changes: [] })),
  };
  TestBed.configureTestingModule({
    imports: [VisualEditorPage],
    providers: [
      provideRouter([]),
      { provide: ContentApi, useValue: content },
      { provide: EditorApi, useValue: { previewToken, previewData } },
      { provide: MediaApi, useValue: { list: () => of([]) } },
      { provide: Thumbnails, useValue: { urls: () => Promise.resolve(new Map()) } },
      { provide: PRESENCE_TRANSPORT, useValue: presence.transport },
      { provide: AuthService, useValue: { claims: signal({ sub: 'me' }), email: signal('me@novan.test') } },
      { provide: ManagementApi, useValue: { me: () => of({ displayName: 'Me Myself', email: 'me@novan.test' }) } },
      {
        provide: SpaceContext,
        useValue: {
          currentSpaceId: signal(null),
          currentSpace: signal({ previewUrl }),
          canEditCurrent: signal(role !== 'viewer'),
          canPublishCurrent: signal(role === 'editor'),
          canManageCurrent: signal(role === 'editor'),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(VisualEditorPage);
  fixture.componentRef.setInput('spaceId', spaceId);
  fixture.componentRef.setInput('entryId', entryId);
  await settle(fixture);
  const el = fixture.nativeElement as HTMLElement;
  const injector = fixture.debugElement.injector;
  const bridge = injector.get(PreviewBridge);
  const store = injector.get(EditorStore);
  const send = vi.spyOn(bridge, 'send').mockReturnValue(true);
  /** The site says it is ready, as the bridge would. */
  const ready = async () => {
    bridge.ready.set({ path: '/', sdkVersion: '0.4.0' });
    await settle(fixture);
  };
  const button = (name: string | RegExp) =>
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => (typeof name === 'string' ? b.textContent?.trim() === name : name.test(b.textContent ?? '')));
  const sent = (type: string) => send.mock.calls.map(([message]) => message).filter((message) => message.type === type);
  const body = () => store.data()['body'] as BlockNode[];
  return { fixture, el, bridge, store, send, sent, ready, button, body, content, previewToken, previewData, presence, frame: () => el.querySelector('iframe') };
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(1);
  else await new Promise((resolve) => setTimeout(resolve));
  await fixture.whenStable();
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => vi.useRealTimers());

describe('VisualEditorPage', () => {
  describe('the preview', () => {
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

    it('renews the token before it expires, through the bridge, without reloading the frame', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      const { fixture, frame, send, previewToken } = await render({ tokens: [() => token('first'), () => token('second')] });

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

    it('sends changes to the site in the delivered shape once the editor pauses', async () => {
      const { store, ready, sent, previewData, fixture } = await render();
      await ready();
      expect(previewData).not.toHaveBeenCalled();

      store.change({ ...startData(), title: 'One' });
      store.change({ ...startData(), title: 'Two' });
      await wait(PREVIEW_DEBOUNCE_MS + 20);
      await settle(fixture);
      expect(previewData).toHaveBeenCalledTimes(1);
      expect(sent('update')).toEqual([{ type: 'update', payload: { data: { ...startData(), title: 'Two', delivered: true } } }]);
    });
  });

  describe('the SEO tab', () => {
    const seoType: ContentType = {
      ...pageType,
      fields: fieldListSchema.parse([
        ...pageType.fields,
        {
          id: 'seo',
          apiId: 'seo',
          label: 'SEO',
          type: 'group',
          fields: [{ id: 'metaTitle', apiId: 'metaTitle', label: 'Search title', type: 'text', max: 60 }],
        },
      ]),
    };
    const tab = (el: HTMLElement, name: string) => [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent?.trim() === name);

    it('shows the search settings and previews, with the site name from site settings', async () => {
      const { fixture, el } = await render({ type: seoType, settings: { siteName: 'Example' } });
      expect(tab(el, 'Blocks')?.getAttribute('aria-selected')).toBe('true');
      expect(el.querySelector<HTMLElement>('#nv-panel-seo')?.hidden).toBe(true);

      tab(el, 'SEO')?.click();
      await settle(fixture);

      expect(tab(el, 'SEO')?.getAttribute('aria-selected')).toBe('true');
      expect(el.querySelector<HTMLElement>('#nv-panel-blocks')?.hidden).toBe(true);
      expect(el.querySelector('.nv-seo-result-title')?.textContent?.trim()).toBe('Home | Example');
      expect(el.querySelector('.nv-seo-result-address')?.textContent?.trim()).toBe('www.example.com');
    });

    it('changes the page as one undoable step per field, and the preview follows', async () => {
      const { fixture, el, store, button } = await render({ type: seoType });
      tab(el, 'SEO')?.click();
      await settle(fixture);

      const input = el.querySelector<HTMLInputElement>('#field-seo-metaTitle');
      for (const value of ['W', 'We', 'Welcome']) {
        input!.value = value;
        input!.dispatchEvent(new Event('input'));
      }
      await settle(fixture);

      expect(store.data()['seo']).toEqual({ metaTitle: 'Welcome' });
      expect(el.querySelector('.nv-seo-result-title')?.textContent?.trim()).toBe('Welcome');
      button('Undo')?.click();
      await settle(fixture);
      expect(store.data()['seo']).toBeUndefined();
    });

    it('moves between tabs with the arrow keys, and back to the blocks when one is selected', async () => {
      const { fixture, el, bridge } = await render({ type: seoType });
      tab(el, 'Blocks')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await settle(fixture);
      expect(tab(el, 'SEO')?.getAttribute('aria-selected')).toBe('true');
      expect(tab(el, 'SEO')?.tabIndex).toBe(0);
      expect(tab(el, 'Blocks')?.tabIndex).toBe(-1);

      bridge.listener?.select(HERO);
      await settle(fixture);
      expect(tab(el, 'Blocks')?.getAttribute('aria-selected')).toBe('true');
      expect(el.querySelector('aside')?.textContent).toContain('Hero banner');
    });
  });

  describe('selecting and editing blocks', () => {
    it('selects the block clicked on the page and shows its fields and style options', async () => {
      const { fixture, el, bridge } = await render();
      expect(el.querySelector('aside')?.textContent).toContain('Nothing selected');
      bridge.listener?.select(HERO);
      await settle(fixture);
      const aside = el.querySelector('aside') as HTMLElement;
      expect(aside.textContent).toContain('Hero banner');
      // Announced, as the click happened inside the frame.
      expect(aside.querySelector('[role="status"]')?.textContent).toContain('Hero banner selected');
      expect(aside.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')?.value).toBe('Hi');
      expect(aside.querySelector<HTMLInputElement>('input[type="radio"][id$="-tone-brand"]')?.checked).toBe(true);
    });

    it('selects from the outline, outlining and scrolling to the block on the page', async () => {
      const { fixture, el, sent, ready } = await render();
      await ready();
      el.querySelector<HTMLButtonElement>(`#nv-outline-select-${CTA}`)?.click();
      await settle(fixture);
      expect(sent('select')).toEqual([{ type: 'select', payload: { uid: CTA } }]);
      expect(sent('scrollTo')).toEqual([{ type: 'scrollTo', payload: { uid: CTA } }]);
      expect(el.querySelector(`#nv-outline-select-${CTA}`)?.getAttribute('aria-current')).toBe('true');
      // The site may let the editor change its text in place.
      expect(sent('editable').slice(-1)[0]).toEqual({ type: 'editable', payload: { uid: CTA, fields: [{ field: 'heading', value: 'Call us', multiline: false }], insert: true } });
    });

    it('changes fields and style options from the panel, and undoes them', async () => {
      const { fixture, el, store, bridge, body, button } = await render();
      bridge.listener?.select(HERO);
      await settle(fixture);
      const input = el.querySelector<HTMLInputElement>('aside input:not([type="radio"])') as HTMLInputElement;
      input.value = 'Hello';
      input.dispatchEvent(new Event('input'));
      el.querySelector<HTMLInputElement>('input[id$="-tone-light"]')?.dispatchEvent(new Event('change'));
      await settle(fixture);
      expect(body()[0]).toEqual({ _uid: HERO, _block: 'hero', heading: 'Hello', _style: { tone: 'light' } });
      expect(store.dirty()).toBe(true);

      button(/Undo/)?.click();
      await settle(fixture);
      expect(body()[0]['_style']).toBeUndefined();
      // Ctrl+Z, away from any field.
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
      await settle(fixture);
      expect(body()[0]['heading']).toBe('Hi');
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
      expect(body()[0]['heading']).toBe('Hello');
    });

    it('adds a block from the picker, at the end of a list or where the site asks', async () => {
      const { fixture, el, bridge, body, button, store } = await render();
      button(/Add block to Content/)?.click();
      await settle(fixture);
      const dialog = el.querySelector('nv-block-picker') as HTMLElement;
      expect(dialog.textContent).toContain('Add a block to Content');
      const choices = [...dialog.querySelectorAll('ul button')].map((b) => b.textContent?.trim());
      expect(choices).toEqual(['Hero banner', 'Call to action', 'Columns']);
      [...dialog.querySelectorAll<HTMLButtonElement>('ul button')][2].click();
      await settle(fixture);
      expect(body().map((b) => b._block)).toEqual(['hero', 'cta', 'columns']);
      expect(store.selected()).toBe(body()[2]._uid);

      // The "+" above the call to action, on the page.
      bridge.listener?.insert(CTA, 'before');
      await settle(fixture);
      [...dialog.querySelectorAll<HTMLButtonElement>('ul button')][0].click();
      await settle(fixture);
      expect(body().map((b) => b._block)).toEqual(['hero', 'hero', 'cta', 'columns']);

      // Inside the columns, only what they allow.
      button(/Add block to Inside Columns/)?.click();
      await settle(fixture);
      expect(dialog.textContent).toContain('Add a block inside Columns');
      expect([...dialog.querySelectorAll('ul button')].map((b) => b.textContent?.trim())).toEqual(['Call to action']);
    });

    it('reorders with the arrow buttons and says where the block went', async () => {
      const { fixture, el, body } = await render();
      el.querySelector<HTMLButtonElement>(`#nv-outline-down-${HERO}`)?.click();
      await settle(fixture);
      expect(body().map((b) => b._uid)).toEqual([CTA, HERO]);
      expect(el.textContent).toContain('Hero banner moved to position 2 of 2.');
      expect(el.querySelector<HTMLButtonElement>(`#nv-outline-down-${HERO}`)?.disabled).toBe(true);
      // Focus stays with the block: on the other arrow, as this one is now disabled.
      expect(document.activeElement?.id).toBe(`nv-outline-up-${HERO}`);
    });

    it('moves blocks into and out of blocks that hold others', async () => {
      const columns = { _uid: '00000000-0000-4000-8000-000000000903', _block: 'columns' };
      const { fixture, body, bridge, button } = await render({ page: entry({ data: { title: 'Home', body: [columns, ...(startData()['body'] as BlockNode[]).slice(1)] } }) });
      bridge.listener?.select(CTA);
      await settle(fixture);
      button('Move into Columns')?.click();
      await settle(fixture);
      expect(body()).toEqual([{ ...columns, children: [{ _uid: CTA, _block: 'cta', heading: 'Call us' }] }]);
      expect(document.activeElement?.id).toBe(`nv-outline-select-${CTA}`);
      button('Move out of Columns')?.click();
      await settle(fixture);
      expect(body().map((b) => b._uid)).toEqual([columns._uid, CTA]);
    });

    it('duplicates, hides and deletes the selected block', async () => {
      const { fixture, body, bridge, button, store } = await render();
      bridge.listener?.select(HERO);
      await settle(fixture);
      button('Duplicate')?.click();
      await settle(fixture);
      expect(body()).toHaveLength(3);
      expect(body()[1]).toMatchObject({ _block: 'hero', heading: 'Hi' });
      expect(body()[1]._uid).not.toBe(HERO);
      expect(store.selected()).toBe(body()[1]._uid);

      button('Hide')?.click();
      await settle(fixture);
      expect(body()[1]._hidden).toBe(true);
      button('Show')?.click();
      await settle(fixture);
      expect(body()[1]._hidden).toBeUndefined();

      button('Delete')?.click();
      await settle(fixture);
      expect(body().map((b) => b._uid)).toEqual([HERO, CTA]);
      expect(store.selected()).toBeNull();
    });

    it('takes text typed on the page, sending nothing back until the editor leaves it', async () => {
      const { fixture, bridge, body, ready, sent, store } = await render();
      await ready();
      bridge.listener?.text({ uid: HERO, field: 'heading', value: 'Typed', done: false });
      bridge.listener?.text({ uid: HERO, field: 'heading', value: 'Typed here', done: false });
      await wait(PREVIEW_DEBOUNCE_MS + 20);
      await settle(fixture);
      expect(body()[0]['heading']).toBe('Typed here');
      expect(sent('update')).toEqual([]);

      bridge.listener?.text({ uid: HERO, field: 'heading', value: 'Typed here', done: true });
      await wait(PREVIEW_DEBOUNCE_MS + 20);
      await settle(fixture);
      expect(sent('update')).toHaveLength(1);
      // One undo step for the whole edit.
      store.undo();
      expect(body()[0]['heading']).toBe('Hi');

      // Only plain text fields of real blocks.
      bridge.listener?.text({ uid: HERO, field: '_block', value: 'cta', done: true });
      bridge.listener?.text({ uid: 'nope', field: 'heading', value: 'x', done: true });
      expect(body()[0]._block).toBe('hero');
    });
  });

  describe('saving', () => {
    it('saves a draft every few seconds while there are changes', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      const { fixture, store, content, el } = await render();
      await vi.advanceTimersByTimeAsync(AUTOSAVE_EVERY_MS);
      expect(content.autosaveEntry).not.toHaveBeenCalled();

      store.change({ ...startData(), title: 'Autosaved' });
      await vi.advanceTimersByTimeAsync(AUTOSAVE_EVERY_MS);
      expect(content.autosaveEntry).toHaveBeenCalledWith(spaceId, entryId, { ...startData(), title: 'Autosaved' });
      expect(store.dirty()).toBe(false);
      fixture.detectChanges();
      expect(el.textContent).toContain('All changes saved at');
    });

    it('does not save malformed drafts, and says why', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      const { fixture, store, content, el } = await render();
      store.change({ ...startData(), title: 42 });
      await vi.advanceTimersByTimeAsync(AUTOSAVE_EVERY_MS);
      fixture.detectChanges();
      expect(content.autosaveEntry).not.toHaveBeenCalled();
      expect(el.textContent).toContain('Some fields need attention');
    });

    it('saves and publishes', async () => {
      const { fixture, store, content, el, button } = await render();
      store.change({ ...startData(), title: 'Published' });
      button('Publish')?.click();
      await settle(fixture);
      expect(content.saveEntry).toHaveBeenCalledWith(spaceId, entryId, { ...startData(), title: 'Published' });
      // The publish dialog (docs/build/13-workflow-publishing.md).
      const dialog = el.querySelector('nv-page-workflow dialog') as HTMLElement;
      [...dialog.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Publish')?.click();
      await settle(fixture);
      expect(content.publish).toHaveBeenCalledWith(spaceId, entryId, null);
      expect(el.textContent).toContain('Published. It is live at /.');
    });

    it('asks before leaving with unsaved changes', async () => {
      const { fixture, store } = await render();
      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
      store.change({ ...startData(), title: 'Unsaved' });
      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    });
  });

  describe('working together', () => {
    it('shows who else has the page open', async () => {
      const { fixture, el, presence } = await render();
      expect(presence.tracked[presence.tracked.length - 1]).toMatchObject({ userId: 'me', name: 'Me Myself', editing: false });
      presence.others(presence.someone(), presence.someone({ session: 'second-tab' }), presence.someone({ session: 'x', userId: 'bo', name: 'Bo Diddley' }));
      await settle(fixture);
      const people = [...el.querySelectorAll('.nv-avatar')].map((li) => li.textContent?.replace(/\s+/g, ' ').trim());
      expect(people).toEqual(['ALAda Lovelace', 'BDBo Diddley']);
    });

    it('says it is editing while there are changes', async () => {
      const { fixture, store, presence } = await render();
      store.change({ ...startData(), title: 'Mine' });
      await settle(fixture);
      expect(presence.tracked[presence.tracked.length - 1]).toMatchObject({ editing: true, since: expect.any(String) });
    });

    it('goes read-only while someone else is editing, and carries on from their changes once they leave', async () => {
      const { fixture, el, presence, ready, sent, button, content } = await render();
      await ready();
      presence.others(presence.someone({ editing: true, since: new Date().toISOString() }));
      await settle(fixture);
      expect(el.textContent).toContain('Ada Lovelace is changing this page');
      expect(button(/Undo/)).toBeUndefined();
      expect(el.querySelector<HTMLInputElement>(`#nv-outline-up-${CTA}`)).toBeNull();
      expect(sent('editable').slice(-1)[0]).toEqual({ type: 'editable', payload: { uid: null, fields: [], insert: false } });

      content.getEntry.mockReturnValue(of(entry({ data: { ...startData(), title: 'Theirs' } })));
      presence.others();
      await settle(fixture);
      expect(el.textContent).not.toContain('is changing this page');
      expect(button(/Undo/)).toBeDefined();
      expect(fixture.debugElement.injector.get(EditorStore).data()['title']).toBe('Theirs');
    });

    it('ignores a lock that has not been renewed for a minute', async () => {
      const { fixture, el, presence } = await render();
      presence.others(presence.someone({ editing: true, at: new Date(Date.now() - 61_000).toISOString() }));
      await settle(fixture);
      expect(el.textContent).not.toContain('is changing this page');
    });
  });

  describe('before publishing', () => {
    it('lists what stops publishing, with a way to the block, and refuses to publish', async () => {
      const { fixture, el, store, button, content } = await render();
      store.change({ ...startData(), body: [{ _uid: HERO, _block: 'hero', heading: '' }, (startData()['body'] as BlockNode[])[1]] });
      await settle(fixture);
      const checklist = el.querySelector('nv-publish-checklist') as HTMLElement;
      expect(checklist.textContent).toContain('Fix before publishing (1)');
      expect(checklist.textContent).toContain('Content › Hero banner block 1 › Heading: This field is required.');

      button('Publish')?.click();
      await settle(fixture);
      expect(content.publish).not.toHaveBeenCalled();
      expect(el.textContent).toContain('Fix one thing in “Before publishing” first.');
      expect(document.activeElement?.id).toBe('nv-checklist-heading');

      checklist.querySelector<HTMLButtonElement>('button')?.click();
      await settle(fixture);
      expect(fixture.debugElement.injector.get(EditorStore).selected()).toBe(HERO);
      // The panel shows the same message by the field.
      expect(el.querySelector('aside')?.textContent).toContain('This field is required.');
    });

    it('warns about heading order on the page as the site draws it', async () => {
      const { fixture, el, bridge } = await render();
      expect(el.querySelector('nv-publish-checklist')?.textContent).toContain('Nothing to fix');
      bridge.headings.set([
        { level: 2, text: 'Hi', uid: HERO },
        { level: 4, text: 'Call us', uid: CTA },
      ]);
      await settle(fixture);
      const text = el.querySelector('nv-publish-checklist')?.textContent ?? '';
      expect(text).toContain('Worth checking (2)');
      expect(text).toContain('no main heading');
      expect(text).toContain('“Call us” is an H4 after an H2');
    });
  });

  describe('when the site does not answer', () => {
    it('offers the form view after 10 seconds, and a way to check the address', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      const { fixture, el } = await render();
      await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS - 100);
      fixture.detectChanges();
      expect(el.textContent).not.toContain('Your site is not answering');
      await vi.advanceTimersByTimeAsync(200);
      fixture.detectChanges();
      expect(el.querySelector('[role="alert"]')?.textContent).toContain('Your site is not answering');
      expect(el.querySelector(`[role="alert"] a[href="/spaces/${spaceId}/content/${entryId}"]`)?.textContent).toContain('Edit in the form');
      expect(el.querySelector(`[role="alert"] a[href="/spaces/${spaceId}/settings/space"]`)).not.toBeNull();
    });

    it('says nothing when the site answers in time', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      const { fixture, el, ready } = await render();
      await ready();
      await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS + 100);
      fixture.detectChanges();
      expect(el.textContent).not.toContain('Your site is not answering');
    });
  });

  describe('for a viewer', () => {
    it('shows the page and blocks but offers no changes', async () => {
      const { fixture, el, bridge, ready, sent, button } = await render({ role: 'viewer' });
      await ready();
      bridge.listener?.select(HERO);
      await settle(fixture);
      expect(el.textContent).toContain('your role cannot change it');
      expect(button(/Undo/)).toBeUndefined();
      expect(button('Delete')).toBeUndefined();
      expect(button(/Add block/)).toBeUndefined();
      expect(el.querySelector<HTMLInputElement>('aside input')?.disabled).toBe(true);
      expect(sent('editable').slice(-1)[0]).toEqual({ type: 'editable', payload: { uid: null, fields: [], insert: false } });
    });
  });
});
