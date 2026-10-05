// components/feature-grid/feature-grid.a11y.spec.ts
// axe-core in jsdom; colour contrast is covered by the starter site's Playwright axe tests.
import { TestBed } from '@angular/core/testing';

import { CmsStylePanelComponent } from '../../cms-style-panel/cms-style-panel.component';
import { expectNoAxeViolations, renderBlock, settingsVariants } from '../../../testing/cms-testing';
import { FeatureGridBlock } from './feature-grid.component';
import { FEATURE_GRID_DEFINITION } from './feature-grid.definition';
import { FEATURE_GRID_SAMPLE_CONTENT, FEATURE_GRID_SCHEMA, type FeatureGridFields } from './feature-grid.schema';

const render = (content: Partial<FeatureGridFields> = FEATURE_GRID_SAMPLE_CONTENT, settings?: unknown) =>
  renderBlock(FeatureGridBlock, content, settings).host;

describe('FeatureGridBlock accessibility', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [FeatureGridBlock, CmsStylePanelComponent] });
  });

  it('has no violations with default settings', async () => {
    await expectNoAxeViolations(render());
  });

  it.each(settingsVariants(FEATURE_GRID_SCHEMA))('has no violations with $name', async ({ settings }) => {
    await expectNoAxeViolations(render(FEATURE_GRID_SAMPLE_CONTENT, settings));
  });

  it('has no violations without a heading, and with twelve long features', async () => {
    const long = 'Gentle hand-scissoring for anxious dogs who do not like the sound of clippers. '.repeat(3);
    await expectNoAxeViolations(render({ features: FEATURE_GRID_SAMPLE_CONTENT.features }));
    await expectNoAxeViolations(
      render({
        heading: long.slice(0, 120),
        intro: long.slice(0, 300),
        features: Array.from({ length: 12 }, (_, index) => ({ icon: 'star' as const, title: `${index + 1}. ${long.slice(0, 70)}`, text: long.slice(0, 240) })),
      }),
    );
  });

  it('has no violations in the editor panel', async () => {
    const fixture = TestBed.createComponent(CmsStylePanelComponent);
    fixture.componentRef.setInput('definition', FEATURE_GRID_DEFINITION);
    fixture.detectChanges();

    await expectNoAxeViolations(fixture.nativeElement);
  });
});
