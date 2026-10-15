// components/card-grid/card-grid.a11y.spec.ts
// axe-core in jsdom; colour contrast is covered by the starter site's Playwright axe tests.
import { TestBed } from '@angular/core/testing';
import type { NovanAsset } from '@black-isle-beef/cms-angular';

import { CmsStylePanelComponent } from '../../cms-style-panel/cms-style-panel.component';
import { expectNoAxeViolations, renderBlock, settingsVariants } from '../../../testing/cms-testing';
import { CardGridBlock } from './card-grid.component';
import { CARD_GRID_DEFINITION } from './card-grid.definition';
import { CARD_GRID_SAMPLE_CONTENT, CARD_GRID_SCHEMA, type CardGridFields } from './card-grid.schema';

const photo = CARD_GRID_SAMPLE_CONTENT.cards?.[0].image as NovanAsset;
const render = (content: Partial<CardGridFields> = CARD_GRID_SAMPLE_CONTENT, settings?: unknown) =>
  renderBlock(CardGridBlock, content, settings).host;

describe('CardGridBlock accessibility', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CardGridBlock, CmsStylePanelComponent] });
  });

  it('has no violations with default settings', async () => {
    await expectNoAxeViolations(render());
  });

  it.each(settingsVariants(CARD_GRID_SCHEMA))('has no violations with $name', async ({ settings }) => {
    await expectNoAxeViolations(render(CARD_GRID_SAMPLE_CONTENT, settings));
  });

  it('has no violations without a heading, with decorative photos and photo-only cards', async () => {
    await expectNoAxeViolations(
      render({
        cards: [
          { image: { ...photo, alt: null }, title: 'Bramble' },
          { image: photo, title: '' },
        ],
      }),
    );
  });

  it('has no violations with twenty-four cards of the longest text', async () => {
    const long = 'Gentle hand-scissoring for anxious dogs who do not like the sound of clippers. '.repeat(2);
    await expectNoAxeViolations(
      render({
        heading: long.slice(0, 120),
        intro: long.slice(0, 300),
        cards: Array.from({ length: 24 }, (_, index) => ({
          image: { ...photo, alt: long },
          title: `${index + 1}. ${long.slice(0, 70)}`,
          subtitle: long.slice(0, 120),
          tag: long.slice(0, 40),
        })),
      }),
    );
  });

  it('has no violations in the editor panel', async () => {
    const fixture = TestBed.createComponent(CmsStylePanelComponent);
    fixture.componentRef.setInput('definition', CARD_GRID_DEFINITION);
    fixture.detectChanges();

    await expectNoAxeViolations(fixture.nativeElement);
  });
});
