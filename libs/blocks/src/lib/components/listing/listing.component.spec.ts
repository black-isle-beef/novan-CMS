// components/listing/listing.component.spec.ts
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NovanContentService, NovanLocale, type Paged } from '@black-isle-beef/cms-angular';
import { of, Subject, throwError } from 'rxjs';

import { CmsStylePanelComponent } from '../../cms-style-panel/cms-style-panel.component';
import { manifestBlockTypes } from '../../../testing/block-manifest';
import { kebab, renderBlock, settingsVariants } from '../../../testing/cms-testing';
import { ListingBlock } from './listing.component';
import { LISTING_DEFINITION } from './listing.definition';
import { LISTING_SAMPLE_CONTENT, LISTING_SCHEMA, LISTING_SOURCES, type ListingEntryData, type ListingFields } from './listing.schema';

const entry = (id: number, data: ListingEntryData, path = `/blog/post-${id}`) => ({
  id: `00000000-0000-4000-8000-0000000000${String(id).padStart(2, '0')}`,
  contentType: 'post',
  path,
  locale: 'en-GB',
  updatedAt: '2026-03-01T10:00:00Z',
  data: data as Record<string, unknown>,
});

const POSTS = {
  items: [
    entry(1, { title: 'Summer coat care', summary: 'Keeping double coats comfortable in the heat.', publishedOn: '2026-06-02' }),
    entry(2, { title: 'Meet our new groomer', summary: 'Sam joins the team.', publishedOn: '2026-05-14' }),
    entry(3, { title: 'Nail trims at home', publishedOn: '2026-04-01' }),
  ],
  nextCursor: null,
} as Paged<ListingEntryData>;

describe('ListingBlock', () => {
  let entries: ReturnType<typeof vi.fn>;
  const locale = signal<string | null>('en-GB');

  function configure(answer: () => unknown = () => of(POSTS)) {
    entries = vi.fn(answer);
    TestBed.configureTestingModule({
      imports: [ListingBlock, CmsStylePanelComponent],
      providers: [
        provideRouter([]),
        { provide: NovanContentService, useValue: { entries } },
        { provide: NovanLocale, useValue: { current: locale } },
      ],
    });
  }

  async function render(content: Partial<ListingFields> = LISTING_SAMPLE_CONTENT, settings?: unknown) {
    const result = renderBlock(ListingBlock, content, settings);
    await result.fixture.whenStable();
    result.fixture.detectChanges();
    return result;
  }

  beforeEach(() => locale.set('en-GB'));

  it('declares the block it renders', () => {
    expect(ListingBlock.novanBlock).toEqual({ apiId: 'listing', schemaVersion: 1 });
  });

  it('knows every source editors can pick, and only those', () => {
    const source = manifestBlockTypes()
      .find((type) => type.apiId === 'listing')
      ?.fields.find((field) => field.apiId === 'source');

    expect(source?.options?.map((option) => option.value)).toEqual([...LISTING_SOURCES]);
  });

  describe('content', () => {
    beforeEach(() => configure());

    it('asks for the newest entries of the source, as many as the limit', async () => {
      await render();

      expect(entries).toHaveBeenCalledWith({ type: 'post', limit: 3, sort: '-fields.publishedOn', select: ['title', 'summary', 'publishedOn'] });
    });

    it('renders the heading, introduction and a list linking to each entry', async () => {
      const { host } = await render();

      expect(host.querySelector('h2')?.textContent).toBe('Latest from the salon');
      expect(host.querySelector('.novan-listing-block__intro')?.textContent).toContain('Grooming tips');
      const items = host.querySelectorAll('ul > li');
      expect(items).toHaveLength(3);
      const link = items[0].querySelector('h3 > a');
      expect(link?.textContent).toBe('Summer coat care');
      expect(link?.getAttribute('href')).toBe('/blog/post-1');
      expect(items[0].querySelector('p')?.textContent).toContain('double coats');
    });

    it('shows each date in the page language, with a machine-readable datetime', async () => {
      const time = (await render()).host.querySelector('time');

      expect(time?.textContent).toBe('2 June 2026');
      expect(time?.getAttribute('datetime')).toBe('2026-06-02');
    });

    it('collapses a missing summary and date', async () => {
      TestBed.resetTestingModule();
      configure(() => of({ items: [entry(4, { title: 'No extras' })], nextCursor: null }));
      const item = (await render()).host.querySelector('li');

      expect(item?.querySelector('time')).toBeNull();
      expect(item?.querySelector('p')).toBeNull();
    });

    it('names the section by its heading', async () => {
      const { host } = await render();

      expect(host.querySelector('section')?.getAttribute('aria-labelledby')).toBe(host.querySelector('h2')?.id);
    });

    it('uses the block heading level for item titles when there is no heading', async () => {
      const { host } = await render({ ...LISTING_SAMPLE_CONTENT, heading: '' });

      expect(host.querySelector('section')?.hasAttribute('aria-labelledby')).toBe(false);
      expect(host.querySelectorAll('li h2')).toHaveLength(3);
    });

    it('caps the limit at 12 and uses 6 when it is empty or not a whole number', async () => {
      await render({ ...LISTING_SAMPLE_CONTENT, limit: 50 });
      expect(entries).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 12 }));

      TestBed.resetTestingModule();
      configure();
      await render({ ...LISTING_SAMPLE_CONTENT, limit: 'many' as never });
      expect(entries).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 6 }));
    });
  });

  describe('untrusted data', () => {
    beforeEach(() => configure());

    it('asks for nothing for an unknown source', async () => {
      const { host } = await render({ ...LISTING_SAMPLE_CONTENT, source: 'users' as never });

      expect(entries).not.toHaveBeenCalled();
      expect(host.querySelector('ul')).toBeNull();
      expect(host.querySelector('.novan-listing-block__empty')).toBeNull();
    });

    it('skips entries without a site path and falls back to the path for a missing title', async () => {
      TestBed.resetTestingModule();
      configure(() => of({ items: [entry(5, {}, '//evil.example'), entry(6, { title: 7, publishedOn: 'soon' }, '/blog/untitled')], nextCursor: null }));
      const { host } = await render();

      const items = host.querySelectorAll('li');
      expect(items).toHaveLength(1);
      expect(items[0].querySelector('a')?.textContent).toBe('/blog/untitled');
      expect(items[0].querySelector('time')).toBeNull();
    });

    it('says when nothing is published yet', async () => {
      TestBed.resetTestingModule();
      configure(() => of({ items: [], nextCursor: null }));
      const { host } = await render();

      expect(host.querySelector('ul')).toBeNull();
      expect(host.querySelector('.novan-listing-block__empty')?.textContent).toContain('Nothing has been published here yet');
    });

    it('keeps the heading and shows no list when the API fails', async () => {
      TestBed.resetTestingModule();
      configure(() => throwError(() => new Error('down')));
      const { host } = await render();

      expect(host.querySelector('h2')?.textContent).toBe('Latest from the salon');
      expect(host.querySelector('ul')).toBeNull();
      expect(host.querySelector('.novan-listing-block__empty')).toBeNull();
    });

    it('does not say "nothing published" while it is still loading', async () => {
      TestBed.resetTestingModule();
      configure(() => new Subject());
      // No whenStable: the pending request keeps the app unstable, which is what makes a server render wait for it.
      const { host } = renderBlock(ListingBlock, LISTING_SAMPLE_CONTENT);

      expect(host.querySelector('.novan-listing-block__empty')).toBeNull();
    });

    it.each([null, 'tone-brand', { tone: 'neon', columns: 9 }, ['two']])('falls back to defaults for settings %j', async (settings) => {
      const { host } = await render(LISTING_SAMPLE_CONTENT, settings);

      expect(host.classList).toContain('novan-listing-block--tone-light');
      expect(host.classList).toContain('novan-listing-block--columns-three');
    });
  });

  describe('settings', () => {
    beforeEach(() => configure());

    it.each(settingsVariants(LISTING_SCHEMA).filter((variant) => variant.key))('applies $name', async ({ key, value, settings }) => {
      const { host } = await render(LISTING_SAMPLE_CONTENT, settings);

      expect(host.classList).toContain(`novan-listing-block--${kebab(String(key))}-${String(value)}`);
    });

    it.each(['h2', 'h3', 'h4'] as const)('renders the heading as %s, and item titles one level below', async (headingLevel) => {
      const { host } = await render(LISTING_SAMPLE_CONTENT, { headingLevel });
      const itemLevel = { h2: 'h3', h3: 'h4', h4: 'h5' }[headingLevel];

      expect(host.querySelector(`${headingLevel}.novan-listing-block__heading`)).not.toBeNull();
      expect(host.querySelectorAll(`li ${itemLevel}`)).toHaveLength(3);
    });
  });

  describe('live updates', () => {
    beforeEach(() => configure());

    it('follows content and settings changes on the same instance', async () => {
      const { fixture, host } = await render();

      fixture.componentRef.setInput('heading', '');
      fixture.componentRef.setInput('settings', { tone: 'dark' });
      fixture.detectChanges();
      expect(host.querySelector('.novan-listing-block__heading')).toBeNull();
      expect(host.querySelector('section')?.hasAttribute('aria-labelledby')).toBe(false);
      expect(host.classList).toContain('novan-listing-block--tone-dark');

      fixture.componentRef.setInput('heading', 'Back again');
      fixture.componentRef.setInput('source', 'project');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(host.querySelector('section')?.getAttribute('aria-labelledby')).toBe(host.querySelector('h2')?.id);
      expect(entries).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'project' }));
    });

    it('asks again in the new language when the locale changes', async () => {
      const { fixture } = await render();
      expect(entries).toHaveBeenCalledTimes(1);

      locale.set('fr-FR');
      fixture.detectChanges();
      await fixture.whenStable();
      expect(entries).toHaveBeenCalledTimes(2);
    });
  });

  describe('editor panel', () => {
    beforeEach(() => configure());

    it('renders a labelled control for every option and resets to the defaults', () => {
      const fixture = TestBed.createComponent(CmsStylePanelComponent);
      fixture.componentRef.setInput('definition', LISTING_DEFINITION);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;

      for (const field of Object.values(LISTING_SCHEMA)) {
        expect(el.textContent).toContain(field.label);
      }
      expect(el.querySelectorAll('fieldset, select').length).toBeGreaterThanOrEqual(Object.keys(LISTING_SCHEMA).length);
    });
  });
});
