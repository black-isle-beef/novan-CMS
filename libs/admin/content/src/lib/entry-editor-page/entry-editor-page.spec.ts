import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MediaApi, Thumbnails } from '@novan/admin-media';
import { Confirm, Shortcuts } from '@novan/admin-shell';
import { SpaceContext, SpaceLocales } from '@novan/admin-spaces';
import {
  type ContentType,
  type Entry,
  type EntrySummary,
  type EntryVersion,
  type EntryWorkflow,
  fieldListSchema,
  type ManagedLocales,
  type ReviewRequest,
  type ScheduleActionRequest,
  type ScheduledAction,
  type SpaceLocale,
  type WorkflowAction,
} from '@novan/shared-schemas';
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
  missingTranslations: [],
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

/** The actions the API would allow, for the fake's role and the page as it now is. */
function actionsFor(role: string, current: Entry, requireApproval: boolean): WorkflowAction[] {
  if (role === 'viewer') return [];
  if (current.status === 'archived') return role === 'editor' || role === 'admin' ? ['restore'] : [];
  if (current.status === 'in_review') return role === 'admin' ? ['edit', 'approve', 'requestChanges', 'archive'] : ['edit'];
  const editor = role === 'editor' || role === 'admin';
  const live = current.publishedVersionId !== null;
  const actions: WorkflowAction[] = ['edit'];
  if (requireApproval) actions.push('submit');
  if (editor && (!requireApproval || role === 'admin')) actions.push('publish');
  if (editor && live) actions.push('unpublish');
  if (editor) actions.push('archive');
  return actions;
}

function fakeApi(initial: Entry = entry(), options: { requireApproval?: boolean; review?: ReviewRequest | null } = {}) {
  const state = { role: 'editor', current: initial };
  const keep = (next: Entry) => {
    state.current = next;
    return of(next);
  };
  const flow = (): EntryWorkflow => ({
    state: state.current.status === 'published' ? 'published' : (state.current.status as EntryWorkflow['state']),
    requireApproval: options.requireApproval ?? false,
    live: state.current.publishedVersionId !== null,
    actions: actionsFor(state.role, state.current, options.requireApproval ?? false),
    review: options.review ?? null,
  });
  return {
    state,
    workflow: vi.fn(() => of(flow())),
    scheduled: [] as ScheduledAction[],
    scheduledActions: vi.fn(function (this: { scheduled: ScheduledAction[] }) {
      return of(this.scheduled);
    }),
    schedule: vi.fn(function (this: { scheduled: ScheduledAction[] }, _s: string, id: string, body: ScheduleActionRequest) {
      const action: ScheduledAction = {
        id: '00000000-0000-4000-8000-000000000901',
        entryId: id,
        action: body.action,
        runAt: body.runAt,
        status: 'scheduled',
        error: null,
        createdBy: null,
        createdByName: 'Sam',
        createdAt: '2026-10-10T09:00:00Z',
        finishedAt: null,
      };
      this.scheduled = [action];
      return of(action);
    }),
    cancelScheduled: vi.fn(function (this: { scheduled: ScheduledAction[] }) {
      this.scheduled = this.scheduled.map((a) => ({ ...a, status: 'cancelled' as const }));
      return of(this.scheduled[0]);
    }),
    references: vi.fn(() => of([] as EntrySummary[])),
    submit: vi.fn(() => keep(entry({ status: 'in_review' }))),
    approve: vi.fn(() => keep(entry({ status: 'published', publishedPath: '/home', publishedVersionId: 'v' }))),
    requestChanges: vi.fn(() => keep(entry())),
    archive: vi.fn(() => keep(entry({ status: 'archived' }))),
    unarchive: vi.fn(() => keep(entry())),
    getEntry: vi.fn(() => of(initial)),
    listContentTypes: vi.fn(() => of([type])),
    listBlockTypes: vi.fn(() => of([])),
    listEntries: vi.fn(() => of([])),
    listFolders: vi.fn(() => of([])),
    saveEntry: vi.fn((_s: string, _id: string, data: Record<string, unknown>) => of(entry({ data, title: String(data['title']) }))),
    autosaveEntry: vi.fn((_s: string, _id: string, data: Record<string, unknown>) => of(entry({ data }))),
    publish: vi.fn(() => keep(entry({ status: 'published', publishedPath: '/home', publishedVersionId: 'v' }))),
    unpublish: vi.fn(() => keep(entry())),
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

const english: SpaceLocale = { code: 'en-GB', name: 'English', fallback: null, isDefault: true, prefix: 'en' };
const french: SpaceLocale = { code: 'fr-FR', name: 'French', fallback: 'en-GB', isDefault: false, prefix: 'fr' };

/** The space's languages, as `SpaceLocales` serves them. */
function fakeLocales(locales: SpaceLocale[] = [english], extra: Partial<ManagedLocales> = {}) {
  const value: ManagedLocales = { locales, prefixes: false, machineTranslation: false, ...extra };
  return { load: () => Promise.resolve(value), value: signal(value), locales: signal(locales), multilingual: signal(locales.length > 1) };
}

async function render(role: 'editor' | 'author' | 'viewer' | 'admin', api = fakeApi(), locales = fakeLocales()) {
  api.state.role = role;
  TestBed.configureTestingModule({
    imports: [EntryEditorPage],
    providers: [
      provideRouter([]),
      { provide: ContentApi, useValue: api },
      { provide: SpaceLocales, useValue: locales },
      ...mediaStubs,
      {
        provide: SpaceContext,
        useValue: {
          currentSpaceId: signal(null),
          currentSpace: signal({ previewUrl: 'https://www.example.com/' }),
          canEditCurrent: signal(role !== 'viewer'),
          canPublishCurrent: signal(role === 'editor' || role === 'admin'),
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
  /** A button in the open dialog. */
  const confirm = async (name: string) => {
    const dialog = [...el.querySelectorAll('ds-modal')].find((modal) => modal.querySelector('dialog[open]'));
    ([...(dialog?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === name) as HTMLButtonElement).click();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  };
  return { fixture, el, api, buttons, click, type, confirm };
}

describe('EntryEditorPage', () => {
  describe('in a space with several languages', () => {
    const translatedType: ContentType = {
      ...type,
      fields: fieldListSchema.parse([
        { id: 'title', apiId: 'title', label: 'Title', type: 'text', required: true, localised: true },
        { id: 'slug', apiId: 'slug', label: 'Slug', type: 'text' },
      ]),
    };
    const translatedEntry = entry({ data: { title: { 'en-GB': 'Home' }, slug: 'home' } });

    function multilingualApi() {
      const api = fakeApi(translatedEntry);
      api.listContentTypes.mockReturnValue(of([translatedType]));
      return Object.assign(api, {
        translate: vi.fn(() =>
          of({
            entry: entry({ data: { title: { 'en-GB': 'Home', 'fr-FR': '[fr-FR] Home' }, slug: 'home' }, hasUnpublishedChanges: true }),
            translated: ['title'],
            provider: 'Pseudo-translation',
          }),
        ),
      });
    }

    it('switches language, says what needs translating, and saves each language under the same field', async () => {
      const { el, fixture, type, click, api } = await render('author', multilingualApi(), fakeLocales([english, french]));
      const select = el.querySelector<HTMLSelectElement>('#locale-language') as HTMLSelectElement;
      expect([...select.options].map((o) => o.textContent?.trim())).toEqual(['English (main language)', 'French (needs translation)']);

      select.value = 'fr-FR';
      select.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      expect(el.textContent).toContain('You are editing the French text.');
      expect(el.querySelector<HTMLInputElement>('#field-slug')?.disabled).toBe(true);
      await type('Title (French)', 'Accueil');
      await click('Save draft');
      expect(api.saveEntry).toHaveBeenCalledWith(spaceId, entryId, { title: { 'en-GB': 'Home', 'fr-FR': 'Accueil' }, slug: 'home' });
      expect([...select.options].map((o) => o.textContent?.trim())).toEqual(['English (main language)', 'French']);
    });

    it('shows the main language alongside, read-only, to translate from', async () => {
      const { el, fixture } = await render('author', multilingualApi(), fakeLocales([english, french]));
      const select = el.querySelector<HTMLSelectElement>('#locale-language') as HTMLSelectElement;
      select.value = 'fr-FR';
      select.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      const compare = el.querySelector<HTMLInputElement>('#locale-compare') as HTMLInputElement;
      compare.checked = true;
      compare.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      expect(el.querySelector<HTMLInputElement>('#field-title-en-GB')?.value).toBe('Home');
      expect(el.querySelector<HTMLInputElement>('#field-title-en-GB')?.disabled).toBe(true);
      expect(el.querySelector<HTMLInputElement>('#field-title-fr-FR')?.disabled).toBe(false);
    });

    it('fills empty translations by machine, as a draft marked for checking', async () => {
      const api = multilingualApi();
      const { el, fixture, click } = await render('author', api, fakeLocales([english, french], { machineTranslation: true }));
      const select = el.querySelector<HTMLSelectElement>('#locale-language') as HTMLSelectElement;
      select.value = 'fr-FR';
      select.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      await click('Machine-translate empty fields');
      expect(api.translate).toHaveBeenCalledWith(spaceId, entryId, { to: 'fr-FR' });
      expect(el.textContent).toContain('Machine-translated into French: check before publishing');
      expect(el.textContent).toContain('Title');
      expect(el.querySelector<HTMLInputElement>('#field-title-fr-FR')?.value).toBe('[fr-FR] Home');
      expect(el.querySelector('#entry-status')?.textContent).toContain('Check every translated field before publishing.');
    });
  });

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

  it('checks required fields before publishing, then saves and publishes from the dialog', async () => {
    const { click, type, api, el, confirm } = await render('editor');
    await click('Publish');
    expect(api.publish).not.toHaveBeenCalled();
    expect(el.querySelector('#entry-errors')?.textContent).toContain('Fix these before publishing');
    expect(el.querySelector('#entry-errors')?.textContent).toContain('Summary: This field is required.');

    await type('Summary', 'Hello');
    await click('Publish');
    expect(api.saveEntry).toHaveBeenCalledWith(spaceId, entryId, { title: 'Home', summary: 'Hello' });
    // The dialog: what changes, the checklist, and a message for the version.
    const dialog = el.querySelector('ds-modal dialog[open]') as HTMLElement;
    expect(dialog.textContent).toContain('This page is not live yet');
    expect(dialog.textContent).toContain('Nothing to fix');
    const message = dialog.querySelector<HTMLTextAreaElement>('#nv-workflow-message') as HTMLTextAreaElement;
    message.value = 'First version';
    message.dispatchEvent(new Event('input'));
    await confirm('Publish');
    expect(api.publish).toHaveBeenCalledWith(spaceId, entryId, 'First version');
    expect(el.querySelector('#entry-status')?.textContent).toContain('Published. It is live at /.');
    expect(el.textContent).toContain('Unpublish');
  });

  it('schedules the publish for a date and time in UK time, lists it, and cancels it', async () => {
    const { click, type, api, el, confirm, fixture } = await render('editor');
    await type('Summary', 'Hello');
    await click('Publish');
    const dialog = el.querySelector('ds-modal dialog[open]') as HTMLElement;
    const later = dialog.querySelector<HTMLInputElement>('#nv-workflow-when-later') as HTMLInputElement;
    later.checked = true;
    later.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(dialog.querySelector('#nv-workflow-message')).toBeNull();

    // A time in the past is refused before asking the API.
    await type('Date (UK time)', '2020-07-01');
    await type('Time (UK time)', '09:00');
    await confirm('Schedule');
    expect(api.schedule).not.toHaveBeenCalled();
    expect(dialog.querySelector('#nv-workflow-when-error')?.textContent).toContain('Choose a time in the future.');
    expect(dialog.querySelector('#nv-workflow-date')?.getAttribute('aria-describedby')).toBe('nv-workflow-when-error');

    const year = new Date().getUTCFullYear() + 1;
    await type('Date (UK time)', `${year}-07-01`);
    await confirm('Schedule');
    // 09:00 BST is 08:00 UTC.
    expect(api.schedule).toHaveBeenCalledWith(spaceId, entryId, { action: 'publish', runAt: `${year}-07-01T08:00:00.000Z` });
    expect(api.publish).not.toHaveBeenCalled();
    expect(el.querySelector('#entry-status')?.textContent).toContain(`will be published on 1 Jul ${year}, 09:00 (UK time)`);
    expect(el.textContent).toContain(`Publishes on 1 Jul ${year}, 09:00 (UK time), set by Sam.`);

    await click('Cancel');
    expect(api.cancelScheduled).toHaveBeenCalledWith(spaceId, entryId, '00000000-0000-4000-8000-000000000901');
    expect(el.textContent).not.toContain('Publishes on');
  });

  it('says when a scheduled publish did not happen, and why', async () => {
    const api = fakeApi();
    api.scheduled = [
      {
        id: '00000000-0000-4000-8000-000000000902',
        entryId,
        action: 'publish',
        runAt: '2026-10-01T08:00:00Z',
        status: 'failed',
        error: 'Your role cannot do this.',
        createdBy: null,
        createdByName: null,
        createdAt: '2026-09-30T09:00:00Z',
        finishedAt: '2026-10-01T08:00:05Z',
      },
    ];
    const { el } = await render('editor', api);
    expect(el.textContent).toContain('The scheduled publish did not happen');
    expect(el.textContent).toContain('It was due on 1 Oct 2026, 09:00 (UK time). Your role cannot do this.');
  });

  it('offers the visual editor for pages', async () => {
    const { el } = await render('author');
    const link = [...el.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Edit on the page');
    expect(link?.getAttribute('href')).toBe(`/spaces/${spaceId}/pages/${entryId}/edit`);
  });

  it('links to the live page once published, disabled until changes are saved and published', async () => {
    const draft = await render('editor');
    expect(draft.el.textContent).not.toContain('View live page');
    TestBed.resetTestingModule();

    const published = entry({ status: 'published', publishedPath: '/home', publishedVersionId: 'v' });
    const api = fakeApi(published);
    api.saveEntry.mockImplementation((_s, _id, data) => of({ ...published, data, hasUnpublishedChanges: true }));
    const { click, type, el, confirm } = await render('editor', api);
    const live = () => [...el.querySelectorAll('a, button')].find((c) => c.textContent?.includes('View live page')) as HTMLElement;

    expect(live().tagName).toBe('A');
    // The home page is at the site's root.
    expect(live().getAttribute('href')).toBe('https://www.example.com/');
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
    await confirm('Publish changes');
    // The home page is at the site's root.
    expect(live().getAttribute('href')).toBe('https://www.example.com/');
    expect(el.querySelector('#entry-live-hint')).toBeNull();
  });

  it("saves with Ctrl+S and publishes with Ctrl+Shift+P, through the shell's shortcuts", async () => {
    const { type, api, fixture, confirm } = await render('editor');
    const shortcuts = TestBed.inject(Shortcuts);
    const press = async (init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { cancelable: true, ...init });
      expect(shortcuts.handle(event)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
    };

    await type('Title', 'Welcome');
    await press({ key: 's', ctrlKey: true });
    expect(api.saveEntry).toHaveBeenCalledWith(spaceId, entryId, { title: 'Welcome' });

    await type('Summary', 'Hello');
    await press({ key: 'P', metaKey: true, shiftKey: true });
    await confirm('Publish');
    expect(api.publish).toHaveBeenCalled();
  });

  it('asks before unpublishing, and does nothing when cancelled', async () => {
    const { click, api } = await render('editor', fakeApi(entry({ status: 'published', publishedPath: '/home', publishedVersionId: 'v' })));
    const confirm = TestBed.inject(Confirm);

    api.references.mockReturnValue(of([{ title: 'Contact', path: '/contact' } as EntrySummary]));
    void click('Unpublish');
    await new Promise((resolve) => setTimeout(resolve));
    expect(confirm.request()?.heading).toBe('Unpublish Home?');
    // It names the pages whose links would lead nowhere.
    expect(confirm.request()?.body).toContain('Contact (/contact)');
    confirm.request()?.answer(false);
    await new Promise((resolve) => setTimeout(resolve));
    expect(api.unpublish).not.toHaveBeenCalled();

    void click('Unpublish');
    await new Promise((resolve) => setTimeout(resolve));
    confirm.request()?.answer(true);
    await new Promise((resolve) => setTimeout(resolve));
    expect(api.unpublish).toHaveBeenCalled();
  });

  describe('with approval', () => {
    const review = (extra: Partial<ReviewRequest> = {}): ReviewRequest => ({
      id: '00000000-0000-4000-8000-000000000501',
      entryId,
      versionId: '00000000-0000-4000-8000-000000000402',
      message: 'Ready for a look',
      requestedBy: 'u1',
      requestedByName: 'Client User',
      requestedAt: '2026-10-08T09:00:00Z',
      decision: null,
      comment: null,
      decidedBy: null,
      decidedByName: null,
      decidedAt: null,
      ...extra,
    });
    const complete = { title: 'Home', summary: 'Hello' };

    it('an author submits a complete page for review, with a note', async () => {
      const api = fakeApi(entry({ data: complete }), { requireApproval: true });
      const { click, el, confirm } = await render('author', api);
      expect(el.textContent).not.toContain('Approve');
      await click('Submit for review');
      const note = el.querySelector<HTMLTextAreaElement>('ds-modal dialog[open] #nv-workflow-message') as HTMLTextAreaElement;
      note.value = 'Ready for a look';
      note.dispatchEvent(new Event('input'));
      await confirm('Submit for review');
      expect(api.submit).toHaveBeenCalledWith(spaceId, entryId, 'Ready for a look');
      expect(el.querySelector('#entry-status')?.textContent).toContain('Sent for review');
    });

    it('says who is waiting, and lets a space admin approve or send it back with a comment', async () => {
      const api = fakeApi(entry({ status: 'in_review', data: complete }), { requireApproval: true, review: review() });
      const { click, el, confirm } = await render('admin', api);
      expect(el.textContent).toContain('Waiting for review');
      expect(el.textContent).toContain('Sent by Client User');
      expect(el.textContent).toContain('Their note: Ready for a look');

      await click('Request changes');
      await confirm('Send back');
      expect(api.requestChanges).not.toHaveBeenCalled();
      expect(el.querySelector('#nv-workflow-comment-error')?.textContent).toContain('Say what should change.');
      const comment = el.querySelector<HTMLTextAreaElement>('#nv-workflow-comment') as HTMLTextAreaElement;
      expect(comment.getAttribute('aria-invalid')).toBe('true');
      comment.value = 'Add our opening hours.';
      comment.dispatchEvent(new Event('input'));
      await confirm('Send back');
      expect(api.requestChanges).toHaveBeenCalledWith(spaceId, entryId, 'Add our opening hours.');
    });

    it('shows the comment when changes were asked for', async () => {
      const sentBack = review({ decision: 'changes_requested', comment: 'Add our opening hours.', decidedByName: 'Novan Admin', decidedAt: '2026-10-08T10:00:00Z' });
      const { el } = await render('author', fakeApi(entry({ data: complete }), { requireApproval: true, review: sentBack }));
      expect(el.textContent).toContain('Changes requested by Novan Admin');
      expect(el.textContent).toContain('Add our opening hours.');
    });

    it('approves from the publish dialog', async () => {
      const api = fakeApi(entry({ status: 'in_review', data: complete }), { requireApproval: true, review: review() });
      const { click, confirm } = await render('admin', api);
      await click('Approve and publish');
      await confirm('Approve and publish');
      expect(api.approve).toHaveBeenCalledWith(spaceId, entryId, null);
    });
  });

  it('keeps an archived page as it is until restored', async () => {
    const api = fakeApi(entry({ status: 'archived' }));
    const { el, click } = await render('editor', api);
    expect(el.textContent).toContain('This page is archived');
    expect(el.querySelector<HTMLInputElement>('form input')?.disabled).toBe(true);
    await click('Restore');
    expect(api.unarchive).toHaveBeenCalled();
    expect(el.querySelector<HTMLInputElement>('form input')?.disabled).toBe(false);
  });

  it('reports unsaved changes, so leaving asks first; never for someone who cannot edit', async () => {
    const author = await render('author');
    expect(author.fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    await author.type('Title', 'Welcome');
    expect(author.fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    await author.click('Save draft');
    expect(author.fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    TestBed.resetTestingModule();

    const viewer = await render('viewer');
    expect(viewer.fixture.componentInstance.hasUnsavedChanges()).toBe(false);
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
          { provide: SpaceLocales, useValue: fakeLocales() },
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

    const dialog = el.querySelector('nv-version-history dialog') as HTMLElement;
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
