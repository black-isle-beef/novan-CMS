// components/hero/hero.a11y.spec.ts
// axe-core in jsdom: structure, names, roles, ARIA, landmarks, headings, alt text.
// Colour contrast cannot be computed in jsdom; the starter site's Playwright axe tests cover it.
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CmsStylePanelComponent } from '../../cms-style-panel/cms-style-panel.component';
import { expectNoAxeViolations, renderBlock, settingsVariants } from '../../../testing/cms-testing';
import { HeroBlock } from './hero.component';
import { HERO_DEFINITION } from './hero.definition';
import { HERO_SAMPLE_CONTENT, HERO_SCHEMA, type HeroFields } from './hero.schema';

const render = (content: Partial<HeroFields> = HERO_SAMPLE_CONTENT, settings?: unknown) => renderBlock(HeroBlock, content, settings).host;

const image = {
  id: '00000000-0000-4000-8000-000000000501',
  url: '/v1/assets/00000000-0000-4000-8000-000000000501/salon.jpg',
  filename: 'salon.jpg',
  mime: 'image/jpeg',
  width: 2400,
  height: 1200,
  focal: null,
};

describe('HeroBlock accessibility', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HeroBlock, CmsStylePanelComponent], providers: [provideRouter([])] });
  });

  it('has no violations with default settings', async () => {
    await expectNoAxeViolations(render());
  });

  it.each(settingsVariants(HERO_SCHEMA))('has no violations with $name', async ({ settings }) => {
    await expectNoAxeViolations(render(HERO_SAMPLE_CONTENT, settings));
  });

  it('has no violations with minimal content', async () => {
    await expectNoAxeViolations(render({ heading: 'Welcome' }));
  });

  it('has no violations with a described image, and with a decorative one', async () => {
    await expectNoAxeViolations(render({ ...HERO_SAMPLE_CONTENT, image: { ...image, alt: 'A spaniel being dried' } }));
    await expectNoAxeViolations(render({ ...HERO_SAMPLE_CONTENT, image: { ...image, alt: null } }));
  });

  it('has no violations with long content', async () => {
    const long = 'Patient, gentle and thorough grooming for nervous dogs of every size. '.repeat(5);
    await expectNoAxeViolations(render({ ...HERO_SAMPLE_CONTENT, heading: long.slice(0, 120), subheading: long.slice(0, 300) }));
  });

  it('has no violations in the editor panel', async () => {
    const fixture = TestBed.createComponent(CmsStylePanelComponent);
    fixture.componentRef.setInput('definition', HERO_DEFINITION);
    fixture.detectChanges();

    await expectNoAxeViolations(fixture.nativeElement);
  });
});
