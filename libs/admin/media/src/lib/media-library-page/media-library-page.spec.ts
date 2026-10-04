import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '@novan/admin-auth';
import { SpaceContext } from '@novan/admin-spaces';
import type { Asset } from '@novan/shared-schemas';
import { of } from 'rxjs';
import { MediaApi } from '../media-api';
import { asset } from '../testing';
import { Thumbnails } from '../thumbnails';
import { MediaLibraryPage } from './media-library-page';

const spaceId = '00000000-0000-4000-8000-000000000200';
const me = '00000000-0000-4000-8000-000000000002';

const library: Asset[] = [
  asset(1, {
    title: 'Red door',
    alt: 'A red front door',
    folder: 'Buildings/Doors',
    tags: ['doors'],
    usageCount: 2,
    uploadedBy: me,
  }),
  asset(2, { title: 'Team', folder: 'People', tags: ['team'] }),
  asset(3, {
    title: 'Price list',
    filename: 'price-list.pdf',
    mime: 'application/pdf',
    kind: 'file',
    width: null,
    height: null,
  }),
];

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

async function render(role: 'editor' | 'author' | 'viewer' = 'editor') {
  const api = {
    list: vi.fn((_s: string, query: { deleted?: string } = {}) =>
      of(query.deleted ? [asset(9, { title: 'Old logo', deletedAt: '2026-10-01T00:00:00Z' })] : library),
    ),
    get: vi.fn((_s: string, id: string) => of({ ...(library.find((a) => a.id === id) as Asset), usages: [] })),
    update: vi.fn((_s: string, id: string, body: object) =>
      of({ ...(library.find((a) => a.id === id) as Asset), ...body, usages: [] }),
    ),
    remove: vi.fn(() => of(undefined)),
  };
  TestBed.configureTestingModule({
    imports: [MediaLibraryPage],
    providers: [
      provideRouter([]),
      { provide: MediaApi, useValue: api },
      { provide: Thumbnails, useValue: { urls: () => Promise.resolve(new Map()) } },
      { provide: AuthService, useValue: { session: signal({ user: { id: me } }) } },
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
  const fixture = TestBed.createComponent(MediaLibraryPage);
  fixture.componentRef.setInput('spaceId', spaceId);
  await fixture.whenStable();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const buttons = (name: RegExp) =>
    [...el.querySelectorAll('button')].filter((b) => name.test(b.textContent?.replace(/\s+/g, ' ').trim() ?? ''));
  const names = () => [...el.querySelectorAll('ul.row button .fw-semibold')].map((n) => n.textContent?.trim());
  const choose = async (id: string, value: string) => {
    const select = el.querySelector<HTMLSelectElement>(`#${id}`) as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  };
  return { api, fixture, el, buttons, names, choose };
}

describe('MediaLibraryPage', () => {
  it('shows the library with folders, missing alt text, and the bin', async () => {
    const { el, names } = await render();
    expect(el.querySelector('h1')?.textContent).toBe('Media');
    expect(names()).toEqual(['Red door', 'Team', 'Price list']);
    const folders = [...el.querySelectorAll('nav[aria-label="Folders"] button')].map((b) => b.textContent?.trim());
    expect(folders).toEqual(['All files', 'Not in a folder', 'Buildings', 'Doors', 'People']);
    // Only images need alt text.
    expect(el.querySelectorAll('ul.row ds-badge').length).toBe(2);
    expect(el.textContent).toContain('No alt text');
    expect(el.querySelector('summary')?.textContent).toContain('Bin (1)');
    expect(el.querySelector('input[type=file]')).not.toBeNull();
  });

  it('filters by folder (with its subfolders), type, tag and search', async () => {
    const { fixture, el, buttons, names, choose } = await render();
    buttons(/^Buildings$/)[0].click();
    await fixture.whenStable();
    expect(names()).toEqual(['Red door']);
    expect(el.querySelector('#media-files-heading')?.textContent).toBe('Buildings');
    expect(buttons(/^Buildings$/)[0].getAttribute('aria-current')).toBe('true');
    // Uploads go in the folder being viewed.
    expect(el.textContent).toContain('New files go in the Buildings folder.');

    buttons(/^All files$/)[0].click();
    await choose('media-kind', 'file');
    expect(names()).toEqual(['Price list']);
    await choose('media-kind', '');
    await choose('media-tag', 'team');
    expect(names()).toEqual(['Team']);
    await choose('media-tag', '');

    const search = el.querySelector<HTMLInputElement>('#media-search') as HTMLInputElement;
    search.value = 'FRONT door';
    search.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(names()).toEqual(['Red door']);
    expect(el.textContent).toContain('1 file');
  });

  it('shows a table in list view', async () => {
    const { fixture, el, buttons } = await render();
    buttons(/List$/)[0].click();
    await fixture.whenStable();
    const rows = [...el.querySelectorAll('tbody tr')].map((row) =>
      [...row.querySelectorAll('th, td')].map((c) => c.textContent?.replace(/\s+/g, ' ').trim()),
    );
    expect(rows[0]).toEqual([
      '',
      'Red door photo-1.jpg',
      'Image',
      '1000 bytes',
      'Added',
      '2 pages',
      expect.any(String),
    ]);
    expect(rows[2][4]).toBe('Not needed');
    expect(buttons(/List$/)[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('a viewer browses but cannot upload', async () => {
    const { el } = await render('viewer');
    expect(el.querySelector('input[type=file]')).toBeNull();
    expect(el.textContent).not.toContain('Upload the first');
  });

  it("opens a file's details, saves its alt text, and warns before deleting a file in use", async () => {
    const { api, fixture, buttons } = await render();
    buttons(/^Red door/)[0].click();
    await fixture.whenStable();
    await fixture.whenStable();
    const doc = fixture.nativeElement.ownerDocument as Document;

    const alt = doc.querySelector<HTMLTextAreaElement>('#asset-alt') as HTMLTextAreaElement;
    expect(alt.value).toBe('A red front door');
    alt.value = 'A bright red front door';
    alt.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    [...doc.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save details')?.click();
    await vi.waitFor(() => expect(api.update).toHaveBeenCalled());
    expect(api.update).toHaveBeenCalledWith(spaceId, library[0].id, {
      title: 'Red door',
      alt: 'A bright red front door',
      tags: ['doors'],
      folder: 'Buildings/Doors',
      focal: null,
    });

    // A folder that is not a folder: the error is announced with the field.
    const folder = doc.querySelector<HTMLInputElement>('#asset-folder') as HTMLInputElement;
    folder.value = '//';
    folder.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    [...doc.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save details')?.click();
    await fixture.whenStable();
    expect(folder.getAttribute('aria-invalid')).toBe('true');
    expect(folder.getAttribute('aria-describedby')).toBe('asset-folder-hint asset-folder-error');
    expect(doc.querySelector('#asset-folder-error')?.textContent).toContain('Enter a folder name.');
    expect(api.update).toHaveBeenCalledTimes(1);

    [...doc.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Delete')?.click();
    await fixture.whenStable();
    expect(doc.body.textContent).toContain('It is in use on 2 published pages. Those pages will stop showing it.');
  });
});
