import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MediaApi, Thumbnails } from '@novan/admin-media';
import { SpaceContext } from '@novan/admin-spaces';
import { type ContentType, type Entry, type EntryVersion, fieldListSchema } from '@novan/shared-schemas';
import { of, throwError } from 'rxjs';
import { ContentApi } from '../content-api';
import { EntryEditorPage } from './entry-editor-page';

const spaceId = '00000000-0000-4000-8000-000000000200';
const entryId = '00000000-0000-4000-8000-000000000301';

const type: ContentType = {
  id: 't',
  spaceId,
  environmentId: 'e',
  apiId: 'page',
  name: 'Page',
  kind: 'page',
  description: null,
  fields: fieldListSchema.parse([
    { id: 'title', apiId: 'title', label: 'Title', type: 'text', required: true, max: 20 },
    { id: 'summary', apiId: 'summary', label: 'Summary', type: 'text', required: true },
  ]),
  createdAt: '',
  updatedAt: '',
};

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
  data: { title: 'Home' },
  currentVersionId: '00000000-0000-4000-8000-000000000402',
  publishedVersionId: null,
  publishedPath: null,
  ...extra,
});

const version = (id: string, extra: Partial<EntryVersion> = {}): EntryVersion => ({
  id,
  entryId,
  message: null,
  autosave: false,
  createdBy: null,
  createdByName: 'Client User',
  createdAt: '2026-10-03T09:30:00Z',
  current: false,
  published: false,
  ...extra,
});

/** The media library is not used by these forms. */
const mediaStubs = [
  { provide: MediaApi, useValue: { list: () => of([]) } },
  { provide: Thumbnails, useValue: { urls: () => Promise.resolve(new Map()) } },
];

function fakeApi(initial: Entry = entry()) {
  return {
    getEntry: vi.fn(() => of(initial)),
    listContentTypes: vi.fn(() => of([type])),
    listBlockTypes: vi.fn(() => of([])),
    listEntries: vi.fn(() => of([])),
    listFolders: vi.fn(() => of([])),
    saveEntry: vi.fn((_s: string, _id: string, data: Record<string, unknown>) => of(entry({ data, title: String(data['title']) }))),
    autosaveEntry: vi.fn((_s: string, _id: string, data: Record<string, unknown>) => of(entry({ data }))),
    publish: vi.fn(() => of(entry({ status: 'published', publishedPath: '/home', publishedVersionId: 'v' }))),
    unpublish: vi.fn(() => of(entry())),
    listVersions: vi.fn(() =>
      of([version('00000000-0000-4000-8000-000000000402', { current: true }), version('00000000-0000-4000-8000-000000000401')]),
    ),
    diff: vi.fn(() => of({ from: 'a', to: 'b', changes: [{ kind: 'changed', path: ['title'], before: 'Old', after: 'Home' }] })),
    restoreVersion: vi.fn(() => of(entry({ data: { title: 'Old' }, currentVersionId: '00000000-0000-4000-8000-000000000401' }))),
  };
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

async function render(role: 'editor' | 'author' | 'viewer', api = fakeApi()) {
  TestBed.configureTestingModule({
    imports: [EntryEditorPage],
    providers: [
      provideRouter([]),
      { provide: ContentApi, useValue: api },
      ...mediaStubs,
      {
        provide: SpaceContext,
        useValue: {
          currentSpaceId: signal(null),
          currentSpace: signal({ previewUrl: 'https://www.example.com/' }),
          canEditCurrent: signal(role !== 'viewer'),
          canPublishCurrent: signal(role === 'editor'),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(EntryEditorPage);
  fixture.componentRef.setInput('spaceId', spaceId);
  fixture.componentRef.setInput('entryId', entryId);
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  /** Buttons on the page itself, outside its dialogs (closed dialogs stay in the DOM). */
  const buttons = () =>
    [...el.querySelectorAll('button')].filter((b) => !b.closest('ds-modal, ds-offcanvas')).map((b) => b.textContent?.trim());
  const click = async (name: string) => {
    ([...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === name) as HTMLButtonElement).click();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  };
  const type = async (label: string, text: string) => {
    const id = [...el.querySelectorAll('label')].find((l) => l.textContent?.trim().startsWith(label))?.htmlFor;
    const input = el.querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  return { fixture, el, api, buttons, click, type };
}

describe('EntryEditorPage', () => {
  it('shows the form for the content type, with actions for the role', async () => {
    const editor = await render('editor');
    expect(editor.el.querySelector('h1')?.textContent).toBe('Home');
    expect(editor.el.textContent).toContain('Page at /home');
    expect(editor.el.textContent).toContain('Draft');
    expect(editor.buttons()).toEqual(expect.arrayContaining(['Save draft', 'Publish', 'Version history', 'Delete']));
    TestBed.resetTestingModule();

    const author = await render('author');
    expect(author.buttons()).toContain('Save draft');
    expect(author.buttons()).not.toContain('Publish');
    expect(author.buttons()).not.toContain('Delete');
    TestBed.resetTestingModule();

    const viewer = await render('viewer');
    expect(viewer.buttons()).not.toContain('Save draft');
    expect(viewer.el.textContent).toContain('your role cannot change it');
    expect(viewer.el.querySelector<HTMLInputElement>('form input')?.disabled).toBe(true);
  });

  it('saves a draft that is incomplete but well formed', async () => {
    const { click, type, api, el } = await render('author');
    await type('Title', 'Welcome');
    expect(el.textContent).toContain('Unsaved changes');
    await click('Save draft');

    expect(api.saveEntry).toHaveBeenCalledWith(spaceId, entryId, { title: 'Welcome' });
    expect(el.querySelector('#entry-status')?.textContent).toContain('Draft saved.');
    expect(document.activeElement?.id).toBe('entry-status');
    expect(el.querySelector('h1')?.textContent).toBe('Welcome');
  });

  it('refuses to save malformed values, with a summary that links to each field', async () => {
    const { click, type, api, el } = await render('author');
    await type('Title', 'A title that is far too long for this');
    await click('Save draft');

    expect(api.saveEntry).not.toHaveBeenCalled();
    const summary = el.querySelector('#entry-errors');
    expect(summary?.textContent).toContain('Fix these before saving');
    const link = summary?.querySelector('a');
    expect(link?.textContent).toBe('Title: Use 20 characters or fewer.');
    expect(el.querySelector(link?.getAttribute('href') ?? '')?.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement?.id).toBe('entry-errors');
  });

  it('checks required fields before publishing, then saves and publishes', async () => {
    const { click, type, api, el } = await render('editor');
    await click('Publish');
    expect(api.publish).not.toHaveBeenCalled();
    expect(el.querySelector('#entry-errors')?.textContent).toContain('Fix these before publishing');
    expect(el.querySelector('#entry-errors')?.textContent).toContain('Summary: This field is required.');

    await type('Summary', 'Hello');
    await click('Publish');
    expect(api.saveEntry).toHaveBeenCalledWith(spaceId, entryId, { title: 'Home', summary: 'Hello' });
    expect(api.publish).toHaveBeenCalled();
    expect(el.querySelector('#entry-status')?.textContent).toContain('Published. It is live at /home.');
    expect(el.textContent).toContain('Unpublish');
  });

  it('links to the live page once published, disabled until changes are saved and published', async () => {
    const draft = await render('editor');
    expect(draft.el.textContent).not.toContain('View live page');
    TestBed.resetTestingModule();

    const published = entry({ status: 'published', publishedPath: '/home', publishedVersionId: 'v' });
    const api = fakeApi(published);
    api.saveEntry.mockImplementation((_s, _id, data) => of({ ...published, data, hasUnpublishedChanges: true }));
    const { click, type, el } = await render('editor', api);
    const live = () => [...el.querySelectorAll('a, button')].find((c) => c.textContent?.includes('View live page')) as HTMLElement;

    expect(live().tagName).toBe('A');
    expect(live().getAttribute('href')).toBe('https://www.example.com/home');
    expect(live().getAttribute('target')).toBe('_blank');
    expect(live().textContent).toContain('opens in a new tab');

    await type('Title', 'Changed');
    expect(live().tagName).toBe('BUTTON');
    expect((live() as HTMLButtonElement).disabled).toBe(true);
    expect(el.querySelector(`#${live().getAttribute('aria-describedby')}`)?.textContent).toContain('Save and publish');

    await click('Save draft');
    expect((live() as HTMLButtonElement).disabled).toBe(true);

    await type('Summary', 'Hello');
    await click('Publish changes');
    expect(live().getAttribute('href')).toBe('https://www.example.com/home');
    expect(el.querySelector('#entry-live-hint')).toBeNull();
  });

  it('shows the API\'s field errors on the fields', async () => {
    const api = fakeApi();
    api.saveEntry.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { code: 'entry_invalid', detail: 'Some fields need attention.', errors: { summary: ['Not like that.'] } },
          }),
      ),
    );
    const { click, type, el } = await render('author', api);
    await type('Title', 'Changed');
    await click('Save draft');
    expect(el.querySelector('#entry-errors')?.textContent).toContain('Summary: Not like that.');
  });

  it('autosaves a few seconds after the last change', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const api = fakeApi();
      TestBed.configureTestingModule({
        imports: [EntryEditorPage],
        providers: [
          provideRouter([]),
          { provide: ContentApi, useValue: api },
          ...mediaStubs,
          { provide: SpaceContext, useValue: { currentSpaceId: signal(null), currentSpace: signal(null), canEditCurrent: signal(true), canPublishCurrent: signal(false) } },
        ],
      });
      const fixture = TestBed.createComponent(EntryEditorPage);
      fixture.componentRef.setInput('spaceId', spaceId);
      fixture.componentRef.setInput('entryId', entryId);
      await vi.runOnlyPendingTimersAsync();
      await fixture.whenStable();
      const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('form input') as HTMLInputElement;
      input.value = 'Typed';
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();

      await vi.advanceTimersByTimeAsync(2000);
      expect(api.autosaveEntry).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1500);
      expect(api.autosaveEntry).toHaveBeenCalledWith(spaceId, entryId, { title: 'Typed' });
      await fixture.whenStable();
      expect((fixture.nativeElement as HTMLElement).querySelector('[role=status]')?.textContent).toContain('All changes saved at');
    } finally {
      vi.useRealTimers();
    }
  });

  it('compares and restores versions from the history', async () => {
    const { click, el, api, fixture } = await render('author');
    await click('Version history');
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();

    const dialog = el.querySelector('dialog') as HTMLElement;
    expect(dialog.textContent).toContain('Current');
    expect(dialog.textContent).toContain('by Client User');

    await click('Compare with current (' + dialog.querySelector('time')?.textContent + ')');
    expect(api.diff).toHaveBeenCalledWith(spaceId, '00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000402');
    expect(dialog.textContent).toContain('Changed Title from “Old” to “Home”');

    const restore = [...dialog.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith('Restore')) as HTMLButtonElement;
    restore.click();
    await fixture.whenStable();
    await click('Restore this version');

    expect(api.restoreVersion).toHaveBeenCalledWith(spaceId, entryId, '00000000-0000-4000-8000-000000000401');
    expect(el.querySelector('h1')?.textContent).toBe('Old');
    expect(el.querySelector('#entry-status')?.textContent).toContain('Version restored.');
  });
});
