import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SpaceContext } from '@novan/admin-spaces';
import type { EntrySummary } from '@novan/shared-schemas';
import { of, throwError } from 'rxjs';
import { ContentApi } from '../content-api';
import { BinPage } from './bin-page';

const spaceId = '00000000-0000-4000-8000-000000000200';
const DAY = 24 * 60 * 60 * 1000;

const binned = (id: string, title: string, daysAgo: number): EntrySummary => ({
  id,
  contentType: 'page',
  contentTypeName: 'Page',
  kind: 'page',
  folderId: null,
  slug: title.toLowerCase().replace(/\s+/g, '-'),
  path: `/${title.toLowerCase().replace(/\s+/g, '-')}`,
  missingTranslations: [],
  title,
  status: 'draft',
  hasUnpublishedChanges: false,
  createdAt: '',
  updatedAt: '',
  publishedAt: null,
  deletedAt: new Date(Date.now() - daysAgo * DAY).toISOString(),
});

async function render(canPublish = true, entries = [binned('a', 'Old news', 29.5), binned('b', 'Pricing', 2)]) {
  const api = {
    listEntries: vi.fn(() => of(entries)),
    restoreEntry: vi.fn((_s: string, id: string) => (id === 'broken' ? throwError(() => new Error('nope')) : of(entries[0]))),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: ContentApi, useValue: api },
      { provide: SpaceContext, useValue: { currentSpaceId: signal(null), canPublishCurrent: signal(canPublish) } },
    ],
  });
  const fixture = TestBed.createComponent(BinPage);
  fixture.componentRef.setInput('spaceId', spaceId);
  const settle = async () => {
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  };
  await settle();
  return { fixture, el: fixture.nativeElement as HTMLElement, api, settle };
}

describe('BinPage', () => {
  it('lists deleted pages, newest first, with how long each has left', async () => {
    const { el, api } = await render();
    expect(api.listEntries).toHaveBeenCalledWith(spaceId, { deleted: 'true' });
    const rows = [...el.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('th, td')].map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim()));
    expect(rows.map((row) => [row[0], row[1], row[3]])).toEqual([
      ['Pricing Page', '/pricing', '28 days'],
      ['Old news Page', '/old-news', '1 day'],
    ]);
  });

  it('restores a page as a draft and says so, with a link to it', async () => {
    const { el, api, settle } = await render();
    el.querySelector<HTMLButtonElement>('tbody tr button')?.click();
    await settle();
    expect(api.restoreEntry).toHaveBeenCalledWith(spaceId, 'b');
    expect(el.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(el.querySelector('#bin-status')?.textContent).toContain('is restored as a draft');
    expect(document.activeElement?.id).toBe('bin-status');
  });

  it('offers no restore to those who cannot, and says when the bin is empty', async () => {
    const authors = await render(false);
    expect(authors.el.querySelector('tbody button')).toBeNull();
    expect(authors.el.textContent).toContain('Ask an editor');
    TestBed.resetTestingModule();
    const empty = await render(true, []);
    expect(empty.el.textContent).toContain('The recycle bin is empty.');
  });
});
