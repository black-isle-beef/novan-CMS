import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import axe from 'axe-core';
import { defineBlocks } from '../blocks';
import { NOVAN_BRIDGE_LOADER } from '../config';
import { provideNovanCms } from '../provide';
import type { NovanEntry, Paged } from '../types';
import { NovanSearch } from './search.component';

const hit = (id: string, title: string, snippet: NovanEntry['search']): NovanEntry => ({
  id,
  contentType: 'page',
  path: `/${title.toLowerCase().replace(/\s+/g, '-')}`,
  locale: 'en-GB',
  updatedAt: '2026-10-11T09:00:00Z',
  data: { title },
  search: snippet,
});

const roses = hit('00000000-0000-4000-8000-000000000001', 'Rose garden', {
  rank: 0.6,
  snippet: [
    { text: 'Our ', match: false },
    { text: 'roses', match: true },
    { text: ' bloom in <June>.', match: false },
  ],
});
const tulips = hit('00000000-0000-4000-8000-000000000002', 'Tulips', { rank: 0.2, snippet: [{ text: 'roses', match: true }] });

function setup(query = '') {
  vi.useFakeTimers();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: PLATFORM_ID, useValue: 'browser' },
      { provide: NOVAN_BRIDGE_LOADER, useValue: () => Promise.reject(new Error('no bridge in tests')) },
      provideNovanCms({ blocks: defineBlocks({}), designSystems: false }),
    ],
  });
  const fixture = TestBed.createComponent(NovanSearch);
  fixture.componentRef.setInput('type', 'page');
  if (query) fixture.componentRef.setInput('query', query);
  fixture.detectChanges();
  return { fixture, host: fixture.nativeElement as HTMLElement, http: TestBed.inject(HttpTestingController) };
}

/** Lets the debounce and the preview check run, then the response render. */
async function flushTimers(fixture: { detectChanges(): void }): Promise<void> {
  await vi.advanceTimersByTimeAsync(400);
  fixture.detectChanges();
}

const type = (host: HTMLElement, text: string) => {
  const input = host.querySelector('input') as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new Event('input'));
};

afterEach(() => vi.useRealTimers());

describe('NovanSearch', () => {
  it('searches as people type, once they pause, and lists what it finds with matches marked', async () => {
    const { fixture, host, http } = setup();
    type(host, 'ro');
    type(host, 'roses');
    await flushTimers(fixture);

    const req = http.expectOne((r) => r.url === '/_novan/delivery/entries');
    expect(req.request.params.get('q')).toBe('roses');
    expect(req.request.params.get('type')).toBe('page');
    expect(req.request.params.get('include')).toBe('0');
    expect(req.request.params.get('select')).toBe('fields.title');
    req.flush({ items: [roses, tulips], nextCursor: null } satisfies Paged);
    fixture.detectChanges();

    const links = [...host.querySelectorAll('ol a')].map((a) => [a.textContent?.trim(), a.getAttribute('href')]);
    expect(links).toEqual([
      ['Rose garden', '/rose-garden'],
      ['Tulips', '/tulips'],
    ]);
    const snippet = host.querySelector('.novan-search__snippet') as HTMLElement;
    expect(snippet.querySelector('mark')?.textContent).toBe('roses');
    // Text, never markup.
    expect(snippet.textContent).toContain('bloom in <June>.');
    expect(host.querySelector('[role="status"]')?.textContent).toBe('2 results for “roses”.');
    http.verify();
  });

  it('waits for two letters, and says when nothing matched', async () => {
    const { fixture, host, http } = setup();
    type(host, 'r');
    await flushTimers(fixture);
    http.verify();
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Type at least 2 letters to search.');

    type(host, 'zebra');
    await flushTimers(fixture);
    http.expectOne((r) => r.url === '/_novan/delivery/entries').flush({ items: [], nextCursor: null });
    fixture.detectChanges();
    expect(host.querySelector('ol')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Nothing found for “zebra”.');
  });

  it('starts with the query it is given, and loads more results on request', async () => {
    const { fixture, host, http } = setup('roses');
    await flushTimers(fixture);
    http.expectOne((r) => r.params.get('q') === 'roses' && !r.params.has('cursor')).flush({ items: [roses], nextCursor: 'next' });
    fixture.detectChanges();
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Showing 1 result for “roses”.');

    (host.querySelector('button[type="button"]') as HTMLButtonElement).click();
    await flushTimers(fixture);
    http.expectOne((r) => r.params.get('cursor') === 'next').flush({ items: [tulips], nextCursor: null });
    // The load is awaited: let it finish.
    await flushTimers(fixture);
    expect(host.querySelectorAll('ol li')).toHaveLength(2);
    expect(host.querySelector('button[type="button"]')).toBeNull();
  });

  it('says so when search is unavailable', async () => {
    const { fixture, host, http } = setup();
    type(host, 'roses');
    (host.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await flushTimers(fixture);
    http.expectOne((r) => r.url === '/_novan/delivery/entries').flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Search is not available right now. Please try again in a minute.');
  });

  it('is a labelled search landmark with no axe violations', async () => {
    const { fixture, host, http } = setup('roses');
    await flushTimers(fixture);
    http.expectOne((r) => r.url === '/_novan/delivery/entries').flush({ items: [roses], nextCursor: null });
    fixture.detectChanges();
    vi.useRealTimers();

    expect(host.querySelector('form')?.getAttribute('role')).toBe('search');
    const input = host.querySelector('input') as HTMLInputElement;
    expect(host.querySelector(`label[for="${input.id}"]`)?.textContent).toBe('Search this site');
    expect(input.getAttribute('aria-describedby')).toBe(host.querySelector('[role="status"]')?.id);
    const results = await axe.run(host, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
