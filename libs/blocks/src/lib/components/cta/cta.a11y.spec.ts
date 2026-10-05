// components/cta/cta.a11y.spec.ts
// axe-core in jsdom; colour contrast is covered by the starter site's Playwright axe tests.
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CmsStylePanelComponent } from '../../cms-style-panel/cms-style-panel.component';
import { expectNoAxeViolations, renderBlock, settingsVariants } from '../../../testing/cms-testing';
import { CtaBlock } from './cta.component';
import { CTA_DEFINITION } from './cta.definition';
import { CTA_SAMPLE_CONTENT, CTA_SCHEMA, type CtaFields } from './cta.schema';

const render = (content: Partial<CtaFields> = CTA_SAMPLE_CONTENT, settings?: unknown) => renderBlock(CtaBlock, content, settings).host;

describe('CtaBlock accessibility', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CtaBlock, CmsStylePanelComponent], providers: [provideRouter([])] });
  });

  it('has no violations with default settings', async () => {
    await expectNoAxeViolations(render());
  });

  it.each(settingsVariants(CTA_SCHEMA))('has no violations with $name', async ({ settings }) => {
    await expectNoAxeViolations(render(CTA_SAMPLE_CONTENT, settings));
  });

  it('has no violations with minimal and long content', async () => {
    const long = 'Tell us about your dog, their coat and anything that worries them about grooming. '.repeat(4);
    await expectNoAxeViolations(render({ heading: 'Book now' }));
    await expectNoAxeViolations(
      render({ heading: long.slice(0, 120), text: long.slice(0, 300), action: { type: 'external', url: 'https://example.com', text: long.slice(0, 200) } }),
    );
  });

  it('has no violations in the editor panel', async () => {
    const fixture = TestBed.createComponent(CmsStylePanelComponent);
    fixture.componentRef.setInput('definition', CTA_DEFINITION);
    fixture.detectChanges();

    await expectNoAxeViolations(fixture.nativeElement);
  });
});
