import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ContentApi } from '@novan/admin-content';
import { MediaApi, Thumbnails } from '@novan/admin-media';
import { SpaceContext } from '@novan/admin-spaces';
import { type ContentType, type Entry, type EntryData, fieldListSchema } from '@novan/shared-schemas';
import { of } from 'rxjs';
import { NavigationPage } from './navigation-page';

const spaceId = '00000000-0000-4000-8000-000000000200';
const navId = '00000000-0000-4000-8000-000000000711';
const home = '00000000-0000-4000-8000-000000000701';
const about = '00000000-0000-4000-8000-000000000702';

const link = { id: 'link', apiId: 'link', label: 'Link', type: 'link', required: true };
const label = { id: 'label', apiId: 'label', label: 'Label', type: 'text', required: true, max: 40 };
const navigationType = {
  id: 't',
  apiId: 'navigation',
  name: 'Navigation',
  kind: 'singleton',
  fields: fieldListSchema.parse([
    {
      id: 'items',
      apiId: 'items',
      label: 'Main menu',
      type: 'group',
      multiple: true,
      max: 3,
      fields: [label, { ...link, required: false }, { id: 'subItems', apiId: 'subItems', label: 'Sub-links', type: 'group', multiple: true, fields: [label, link] }],
    },
  ]),
} as ContentType;

const entry = (data: EntryData, extra: Partial<Entry> = {}): Entry =>
  ({ id: navId, contentType: 'navigation', kind: 'singleton', status: 'published', hasUnpublishedChanges: false, data, ...extra }) as Entry;

async function render(options: { role?: 'editor' | 'author' | 'viewer'; data?: EntryData } = {}) {
  const role = options.role ?? 'editor';
  const start = options.data ?? {
    items: [
      { label: 'Home', link: { type: 'internal', entryId: home } },
      { label: 'About', link: { type: 'internal', entryId: about } },
    ],
  };
  const content = {
    listContentTypes: vi.fn(() => of([navigationType])),
    listEntries: vi.fn((_s: string, query?: { contentType?: string }) =>
      of(
        query?.contentType
          ? [{ id: navId, contentType: 'navigation', kind: 'singleton', title: 'Navigation', path: '/navigation' }]
          : [
              { id: home, contentType: 'page', kind: 'page', title: 'Home', path: '/home' },
              { id: about, contentType: 'page', kind: 'page', title: 'About', path: '/about' },
              { id: navId, contentType: 'navigation', kind: 'singleton', title: 'Navigation', path: '/navigation' },
            ],
      ),
    ),
    getEntry: vi.fn(() => of(entry(start))),
    saveEntry: vi.fn((_s: string, _id: string, data: EntryData) => of(entry(data, { hasUnpublishedChanges: true }))),
    publish: vi.fn(() => of(entry({}))),
  };
  TestBed.configureTestingModule({
    imports: [NavigationPage],
    providers: [
      provideRouter([]),
      { provide: ContentApi, useValue: content },
      { provide: MediaApi, useValue: { list: () => of([]) } },
      { provide: Thumbnails, useValue: { urls: () => Promise.resolve(new Map()) } },
      {
        provide: SpaceContext,
        useValue: { currentSpaceId: signal(null), canEditCurrent: signal(role !== 'viewer'), canPublishCurrent: signal(role === 'editor') },
      },
    ],
  });
  const fixture = TestBed.createComponent(NavigationPage);
  fixture.componentRef.setInput('spaceId', spaceId);
  await settle(fixture);
  const el = fixture.nativeElement as HTMLElement;
  const button = (name: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.replace(/\s+/g, ' ').trim() === name);
  const labels = () => [...el.querySelectorAll<HTMLInputElement>('input[id$="-label"]')].map((input) => `${input.id}=${input.value}`);
  return { fixture, el, content, button, labels };
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
}

describe('NavigationPage', () => {
  it('shows the menu as a tree, with the page form’s controls for each item', async () => {
    const { el, labels } = await render();

    expect(el.querySelector('h2')?.textContent).toBe('Main menu');
    expect(labels()).toEqual(['field-items-0-label=Home', 'field-items-1-label=About']);
    const page = el.querySelector<HTMLSelectElement>('#field-items-0-link-entry');
    expect([...(page?.options ?? [])].map((option) => option.textContent?.trim())).toEqual(['Choose a page', 'Home (/home)', 'About (/about)']);
  });

  it('moves an item into the one above as a sub-link and back, announcing each move', async () => {
    const { fixture, el, button, labels } = await render();

    button('Make it a sub-link of “Home”')?.click();
    await settle(fixture);
    expect(labels()).toEqual(['field-items-0-label=Home', 'field-items-0-subItems-0-label=About']);
    expect(el.querySelector('.visually-hidden[role="status"]')?.textContent).toContain('Moved into “Home” as sub-link 1');
    expect(document.activeElement?.id).toBe('nav-items-0-0-out');

    button('Make it a menu item')?.click();
    await settle(fixture);
    expect(labels()).toEqual(['field-items-0-label=Home', 'field-items-1-label=About']);
  });

  it('adds items up to the most the menu holds, and removes them', async () => {
    const { fixture, el, button, labels } = await render();

    button('Add a menu item')?.click();
    await settle(fixture);
    expect(labels()).toHaveLength(3);
    expect(document.activeElement?.id).toBe('field-items-2-label');
    expect(button('Add a menu item')).toBeUndefined();
    expect(el.textContent).toContain('the most it can hold (3)');

    button('Remove “About”')?.click();
    await settle(fixture);
    expect(labels()).toEqual(['field-items-0-label=Home', 'field-items-1-label=']);
  });

  it('checks the menu before publishing, then saves and publishes it', async () => {
    const { fixture, el, button, content } = await render();
    button('Add a menu item')?.click();
    await settle(fixture);

    button('Publish changes')?.click();
    await settle(fixture);
    const summary = el.querySelector('#navigation-errors');
    expect(summary?.textContent).toContain('Main menu › Item 3 › Label');
    expect(summary?.querySelector('a')?.getAttribute('href')).toBe('#field-items-2-label');
    expect(content.publish).not.toHaveBeenCalled();

    const input = el.querySelector<HTMLInputElement>('#field-items-2-label');
    input!.value = 'Blog';
    input!.dispatchEvent(new Event('input'));
    await settle(fixture);
    button('Publish changes')?.click();
    await settle(fixture);

    expect(content.saveEntry).toHaveBeenCalledWith(spaceId, navId, expect.objectContaining({ items: expect.arrayContaining([{ label: 'Blog' }]) }));
    expect(content.publish).toHaveBeenCalledWith(spaceId, navId);
    expect(el.querySelector('#navigation-status')?.textContent).toContain('Published');
  });

  it('is read only for viewers, and only saves drafts for authors', async () => {
    const viewer = await render({ role: 'viewer' });
    expect(viewer.button('Add a menu item')).toBeUndefined();
    expect(viewer.el.querySelector<HTMLInputElement>('#field-items-0-label')?.disabled).toBe(true);
    TestBed.resetTestingModule();

    const author = await render({ role: 'author' });
    expect(author.button('Publish changes')).toBeUndefined();
    expect(author.button('Save draft')).toBeDefined();
  });
});
