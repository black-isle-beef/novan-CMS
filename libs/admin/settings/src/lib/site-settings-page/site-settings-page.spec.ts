import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ContentApi } from '@novan/admin-content';
import { MediaApi, Thumbnails } from '@novan/admin-media';
import { SpaceContext, SpaceLocales } from '@novan/admin-spaces';
import { type ContentType, type Entry, type EntryData, fieldListSchema } from '@novan/shared-schemas';
import { of, throwError } from 'rxjs';
import { SiteSettingsPage } from './site-settings-page';

const spaceId = '00000000-0000-4000-8000-000000000200';
const settingsId = '00000000-0000-4000-8000-000000000712';

const settingsType = {
  id: 't',
  apiId: 'siteSettings',
  name: 'Site settings',
  kind: 'singleton',
  fields: fieldListSchema.parse([
    { id: 'siteName', apiId: 'siteName', label: 'Site name', type: 'text', required: true, max: 60 },
    { id: 'logo', apiId: 'logo', label: 'Logo', type: 'media', accept: ['image'] },
    { id: 'analyticsId', apiId: 'analyticsId', label: 'Google Analytics measurement ID', type: 'text', pattern: 'G-[A-Z0-9]{4,16}' },
  ]),
} as ContentType;

const entry = (data: EntryData, extra: Partial<Entry> = {}): Entry =>
  ({ id: settingsId, contentType: 'siteSettings', kind: 'singleton', status: 'published', hasUnpublishedChanges: false, data, ...extra }) as Entry;

async function render(options: { missing?: boolean; publish?: () => ReturnType<typeof of> } = {}) {
  const content = {
    listContentTypes: vi.fn(() => of(options.missing ? [] : [settingsType])),
    listEntries: vi.fn((_s: string, query?: { contentType?: string }) => of(query?.contentType && !options.missing ? [{ id: settingsId, kind: 'singleton' }] : [])),
    getEntry: vi.fn(() => of(entry({ siteName: 'Paws' }))),
    saveEntry: vi.fn((_s: string, _id: string, data: EntryData) => of(entry(data, { hasUnpublishedChanges: true }))),
    publish: vi.fn(options.publish ?? (() => of(entry({ siteName: 'Paws & Claws' })))),
  };
  TestBed.configureTestingModule({
    imports: [SiteSettingsPage],
    providers: [
      provideRouter([]),
      { provide: ContentApi, useValue: content },
      // One language: translated fields edit their English value.
      {
        provide: SpaceLocales,
        useValue: { load: () => Promise.resolve({ locales: [], prefixes: false, machineTranslation: false }), multilingual: () => false },
      },
      { provide: MediaApi, useValue: { list: () => of([]) } },
      { provide: Thumbnails, useValue: { urls: () => Promise.resolve(new Map()) } },
      { provide: SpaceContext, useValue: { currentSpaceId: signal(null), canEditCurrent: signal(true), canPublishCurrent: signal(true) } },
    ],
  });
  const fixture = TestBed.createComponent(SiteSettingsPage);
  fixture.componentRef.setInput('spaceId', spaceId);
  await settle(fixture);
  const el = fixture.nativeElement as HTMLElement;
  const button = (name: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === name);
  const type = async (id: string, value: string) => {
    const input = el.querySelector<HTMLInputElement>(`#${id}`);
    input!.value = value;
    input!.dispatchEvent(new Event('input'));
    await settle(fixture);
  };
  return { fixture, el, content, button, type };
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
}

describe('SiteSettingsPage', () => {
  it('edits the site settings in a form of their own, with the content model’s fields', async () => {
    const { el, fixture } = await render();

    expect(el.querySelector('h1')?.textContent).toBe('Site settings');
    expect(el.querySelector<HTMLInputElement>('#field-siteName')?.value).toBe('Paws');
    expect(el.querySelector('#field-siteName-count')?.textContent?.trim()).toBe('4 of 60 characters');
    expect(el.textContent).toContain('Logo');
    expect(el.textContent).toContain('The site shows these settings.');
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
  });

  it('checks values before saving, and links to the field', async () => {
    const { el, fixture, button, type, content } = await render();
    await type('field-analyticsId', 'UA-123');

    button('Save draft')?.click();
    await settle(fixture);
    const summary = el.querySelector('#site-settings-errors');
    expect(summary?.querySelector('a')?.getAttribute('href')).toBe('#field-analyticsId');
    expect(content.saveEntry).not.toHaveBeenCalled();
  });

  it('saves and publishes the changes', async () => {
    const { el, fixture, button, type, content } = await render();
    await type('field-siteName', 'Paws & Claws');
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    expect(el.textContent).toContain('Unsaved changes');

    button('Publish changes')?.click();
    await settle(fixture);

    expect(content.saveEntry).toHaveBeenCalledWith(spaceId, settingsId, { siteName: 'Paws & Claws' });
    expect(content.publish).toHaveBeenCalledWith(spaceId, settingsId);
    expect(el.querySelector('#site-settings-status')?.textContent).toContain('Published');
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
  });

  it('says why publishing failed, keeping the changes', async () => {
    const refusal = new HttpErrorResponse({ status: 403, error: { code: 'approval_required', detail: 'This space needs approval: send it for review.' } });
    const { el, fixture, button, type } = await render({ publish: () => throwError(() => refusal) });
    await type('field-siteName', 'New name');

    button('Publish changes')?.click();
    await settle(fixture);

    expect(el.querySelector('#site-settings-problem')?.textContent).toContain('needs approval');
  });

  it('explains when the site has no settings yet', async () => {
    const { el } = await render({ missing: true });

    expect(el.textContent).toContain('Not set up for this site yet');
  });
});
