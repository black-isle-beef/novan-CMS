// components/listing/listing.a11y.spec.ts
// axe-core in jsdom; colour contrast is covered by the starter site's Playwright axe tests.
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NovanContentService, NovanLocale } from '@black-isle-beef/cms-angular';
import { of } from 'rxjs';

import { CmsStylePanelComponent } from '../../cms-style-panel/cms-style-panel.component';
import { expectNoAxeViolations, renderBlock, settingsVariants } from '../../../testing/cms-testing';
import { ListingBlock } from './listing.component';
import { LISTING_DEFINITION } from './listing.definition';
import { LISTING_SAMPLE_CONTENT, LISTING_SCHEMA, type ListingFields } from './listing.schema';

const long = 'Gentle hand-scissoring for anxious dogs who do not like the sound of clippers. '.repeat(4);

const posts = (count: number) => ({
  items: Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`,
    contentType: 'post',
    path: `/blog/post-${index}`,
    locale: 'en-GB',
    updatedAt: '2026-03-01T10:00:00Z',
    data: { title: `${index + 1}. ${long.slice(0, 110)}`, summary: long.slice(0, 280), publishedOn: '2026-03-01' },
  })),
  nextCursor: null,
});

describe('ListingBlock accessibility', () => {
  let count = 3;

  beforeEach(() => {
    count = 3;
    TestBed.configureTestingModule({
      imports: [ListingBlock, CmsStylePanelComponent],
      providers: [
        provideRouter([]),
        { provide: NovanContentService, useValue: { entries: () => of(posts(count)) } },
        { provide: NovanLocale, useValue: { current: signal('en-GB') } },
      ],
    });
  });

  async function render(content: Partial<ListingFields> = LISTING_SAMPLE_CONTENT, settings?: unknown): Promise<HTMLElement> {
    const { fixture, host } = renderBlock(ListingBlock, content, settings);
    await fixture.whenStable();
    fixture.detectChanges();
    return host;
  }

  it('has no violations with default settings', async () => {
    await expectNoAxeViolations(await render());
  });

  it.each(settingsVariants(LISTING_SCHEMA))('has no violations with $name', async ({ settings }) => {
    await expectNoAxeViolations(await render(LISTING_SAMPLE_CONTENT, settings));
  });

  it('has no violations without a heading, with twelve long items, and with none', async () => {
    await expectNoAxeViolations(await render({ source: 'post', limit: 3 }));
    count = 12;
    await expectNoAxeViolations(await render({ heading: long.slice(0, 120), intro: long.slice(0, 300), source: 'post', limit: 12 }));
    count = 0;
    await expectNoAxeViolations(await render());
  });

  it('has no violations in the editor panel', async () => {
    const fixture = TestBed.createComponent(CmsStylePanelComponent);
    fixture.componentRef.setInput('definition', LISTING_DEFINITION);
    fixture.detectChanges();

    await expectNoAxeViolations(fixture.nativeElement);
  });
});
