import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { SpaceContext } from '@novan/admin-spaces';
import { type ContentType, type EntrySummary, type Folder, fieldListSchema } from '@novan/shared-schemas';
import { of } from 'rxjs';
import { ContentApi } from '../content-api';
import { ContentPage } from './content-page';

const spaceId = '00000000-0000-4000-8000-000000000200';

const blog: Folder = { id: 'f1', parentId: null, name: 'Blog', slug: 'blog', path: '/blog', createdAt: '', updatedAt: '' };
const summary = (id: string, title: string, extra: Partial<EntrySummary> = {}): EntrySummary => ({
  id,
  contentType: 'page',
  contentTypeName: 'Page',
  kind: 'page',
  folderId: null,
  slug: title.toLowerCase(),
  path: `/${title.toLowerCase()}`,
  locale: 'en-GB',
  title,
  status: 'draft',
  hasUnpublishedChanges: false,
  createdAt: '',
  updatedAt: '',
  publishedAt: null,
  deletedAt: null,
  ...extra,
});
const pageType = {
  apiId: 'page',
  name: 'Page',
  fields: fieldListSchema.parse([
    { id: 't', apiId: 'title', label: 'Title', type: 'text' },
    { id: 's', apiId: 'slug', label: 'Slug', type: 'text' },
  ]),
} as ContentType;

function fakeApi() {
  return {
    listFolders: vi.fn(() => of([blog])),
    listEntries: vi.fn((_s: string, query: { deleted?: string } = {}) =>
      of(
        query.deleted
          ? [summary('d', 'Old', { deletedAt: '2026-10-01' })]
          : [
              summary('1', 'Home', { status: 'published' }),
              summary('2', 'Hello', { folderId: 'f1', path: '/blog/hello', status: 'published', hasUnpublishedChanges: true }),
            ],
      ),
    ),
    listContentTypes: vi.fn(() => of([pageType])),
    createEntry: vi.fn(() => of({ id: 'new' })),
    createFolder: vi.fn(() => of(blog)),
    restoreEntry: vi.fn(() => of({})),
  };
}

/** Text of the page outside its dialogs (closed dialogs stay in the DOM). */
const pageText = (el: HTMLElement): string =>
  [...el.childNodes].filter((node) => !(node instanceof HTMLElement && node.tagName === 'DS-MODAL')).map((node) => node.textContent).join(' ');

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

async function render(role: 'editor' | 'author' | 'viewer', add?: string) {
  const api = fakeApi();
  TestBed.configureTestingModule({
    imports: [ContentPage],
    providers: [
      provideRouter([]),
      { provide: ContentApi, useValue: api },
      {
        provide: SpaceContext,
        useValue: {
          currentSpaceId: signal(null),
          currentSpace: signal({ name: 'Demo site' }),
          canEditCurrent: signal(role !== 'viewer'),
          canPublishCurrent: signal(role === 'editor'),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(ContentPage);
  fixture.componentRef.setInput('spaceId', spaceId);
  if (add) fixture.componentRef.setInput('add', add);
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const click = async (name: string) => {
    ([...el.querySelectorAll('button')].find((b) => b.textContent?.replace(/\s+/g, ' ').trim() === name) as HTMLButtonElement).click();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  };
  const fill = async (id: string, text: string) => {
    const input = el.querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  return { fixture, el, api, click, fill };
}

describe('ContentPage', () => {
  it('shows folders and pages as a tree, with their status in words', async () => {
    const { el, click } = await render('editor');
    expect(el.querySelector('h1')?.textContent).toBe('Pages');

    const folder = el.querySelector<HTMLButtonElement>('[aria-expanded]') as HTMLButtonElement;
    expect(folder.textContent?.replace(/\s+/g, ' ').trim()).toBe('Blog folder');
    expect(folder.getAttribute('aria-expanded')).toBe('true');
    const links = [...el.querySelectorAll<HTMLAnchorElement>('nv-page-tree a')].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      ['Hello', `/spaces/${spaceId}/content/2`],
      ['Home', `/spaces/${spaceId}/content/1`],
    ]);
    expect(el.textContent).toContain('Changes not published');

    folder.click();
    await new Promise((resolve) => setTimeout(resolve));
    expect(el.querySelector('[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false');
    expect([...el.querySelectorAll('nv-page-tree a')].map((a) => a.textContent)).toEqual(['Home']);
  });

  it('searches by title or address', async () => {
    const { el, fill } = await render('viewer');
    await fill('content-search', 'blog');
    expect(el.querySelector('#results-heading')?.textContent?.trim()).toBe('1 result');
    expect([...el.querySelectorAll('section a')].map((a) => a.textContent)).toEqual(['Hello']);
  });

  it('shows actions by role', async () => {
    const editor = await render('editor');
    expect(pageText(editor.el)).toContain('New page');
    expect(editor.el.querySelector('nv-page-tree')?.textContent).toContain('Rename');
    expect(editor.el.querySelector('details')?.textContent).toContain('Restore');
    TestBed.resetTestingModule();

    const author = await render('author');
    expect(pageText(author.el)).toContain('New page');
    expect(author.el.querySelector('nv-page-tree')?.textContent).not.toContain('Rename');
    expect(author.el.querySelector('details')?.textContent).not.toContain('Restore');
    TestBed.resetTestingModule();

    const viewer = await render('viewer');
    expect(pageText(viewer.el)).not.toContain('New page');
  });

  it('creates a page with a slug from its title, then opens it', async () => {
    const { click, fill, api, fixture } = await render('author');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await click('New page');
    await fill('new-entry-title', 'About Us');
    expect((fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#new-entry-slug')?.value).toBe('about-us');
    await click('Create page');

    expect(api.createEntry).toHaveBeenCalledWith(spaceId, { contentType: 'page', folderId: null, slug: 'about-us', data: { title: 'About Us' } });
    expect(navigate).toHaveBeenCalledWith(['/spaces', spaceId, 'content', 'new']);
  });

  it('opens the New page dialog from a ?add=page link (the dashboard), then drops the parameter', async () => {
    const navigate = vi.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);
    const { el } = await render('author', 'page');

    expect(el.querySelector<HTMLDialogElement>('ds-modal dialog')?.open).toBe(true);
    expect(navigate).toHaveBeenCalledWith([], { queryParams: { add: null }, queryParamsHandling: 'merge', replaceUrl: true });
  });

  it('ignores ?add=page for someone who cannot add pages', async () => {
    const { el } = await render('viewer', 'page');
    expect(el.querySelector<HTMLDialogElement>('ds-modal dialog')?.open).toBe(false);
  });

  it('asks for a title before creating', async () => {
    const { click, api, el } = await render('author');
    await click('New page');
    await click('Create page');
    expect(api.createEntry).not.toHaveBeenCalled();
    expect(el.querySelector('#new-entry-title')?.getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('#new-entry-title-error')?.textContent).toContain('Enter a title.');
  });
});
