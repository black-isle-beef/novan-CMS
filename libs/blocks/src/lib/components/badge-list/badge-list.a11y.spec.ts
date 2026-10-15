// components/badge-list/badge-list.a11y.spec.ts
// axe-core in jsdom; colour contrast is covered by the starter site's Playwright axe tests.
import { TestBed } from '@angular/core/testing';

import { CmsStylePanelComponent } from '../../cms-style-panel/cms-style-panel.component';
import { expectNoAxeViolations, renderBlock, settingsVariants } from '../../../testing/cms-testing';
import { BadgeListBlock } from './badge-list.component';
import { BADGE_LIST_DEFINITION } from './badge-list.definition';
import { BADGE_LIST_SAMPLE_CONTENT, BADGE_LIST_SCHEMA, type BadgeListFields } from './badge-list.schema';

const render = (content: Partial<BadgeListFields> = BADGE_LIST_SAMPLE_CONTENT, settings?: unknown) =>
  renderBlock(BadgeListBlock, content, settings).host;

describe('BadgeListBlock accessibility', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BadgeListBlock, CmsStylePanelComponent] });
  });

  it('has no violations with default settings', async () => {
    await expectNoAxeViolations(render());
  });

  it.each(settingsVariants(BADGE_LIST_SCHEMA))('has no violations with $name', async ({ settings }) => {
    await expectNoAxeViolations(render(BADGE_LIST_SAMPLE_CONTENT, settings));
  });

  it('has no violations without a heading, and with twenty long badges', async () => {
    const long = 'Certified in canine first aid and low-stress handling. '.repeat(2);
    await expectNoAxeViolations(render({ badges: BADGE_LIST_SAMPLE_CONTENT.badges }));
    await expectNoAxeViolations(
      render({
        heading: long.slice(0, 120),
        intro: long.slice(0, 300),
        badges: Array.from({ length: 20 }, () => ({ label: long.slice(0, 60) })),
      }),
    );
  });

  it('has no violations in the editor panel', async () => {
    const fixture = TestBed.createComponent(CmsStylePanelComponent);
    fixture.componentRef.setInput('definition', BADGE_LIST_DEFINITION);
    fixture.detectChanges();

    await expectNoAxeViolations(fixture.nativeElement);
  });
});
