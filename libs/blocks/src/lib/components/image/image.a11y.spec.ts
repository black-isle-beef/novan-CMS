// components/image/image.a11y.spec.ts
// axe-core in jsdom; colour contrast is covered by the starter site's Playwright axe tests.
import { TestBed } from '@angular/core/testing';
import type { NovanAsset } from '@black-isle-beef/cms-angular';

import { CmsStylePanelComponent } from '../../cms-style-panel/cms-style-panel.component';
import { expectNoAxeViolations, renderBlock, settingsVariants } from '../../../testing/cms-testing';
import { ImageBlock } from './image.component';
import { IMAGE_DEFINITION } from './image.definition';
import { IMAGE_SAMPLE_CONTENT, IMAGE_SCHEMA, type ImageFields } from './image.schema';

const photo = IMAGE_SAMPLE_CONTENT.image as NovanAsset;
const render = (content: Partial<ImageFields> = IMAGE_SAMPLE_CONTENT, settings?: unknown) => renderBlock(ImageBlock, content, settings).host;

describe('ImageBlock accessibility', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ImageBlock, CmsStylePanelComponent] });
  });

  it('has no violations with default settings', async () => {
    await expectNoAxeViolations(render());
  });

  it.each(settingsVariants(IMAGE_SCHEMA))('has no violations with $name', async ({ settings }) => {
    await expectNoAxeViolations(render(IMAGE_SAMPLE_CONTENT, settings));
  });

  it('has no violations with a decorative image and no caption', async () => {
    await expectNoAxeViolations(render({ image: { ...photo, alt: null } }));
  });

  it('has no violations with a long caption and alt text', async () => {
    const long = 'Two groomers drying a large golden retriever after its bath in the salon. '.repeat(3);
    await expectNoAxeViolations(render({ image: { ...photo, alt: long }, caption: long.slice(0, 200) }));
  });

  it('has no violations in the editor panel', async () => {
    const fixture = TestBed.createComponent(CmsStylePanelComponent);
    fixture.componentRef.setInput('definition', IMAGE_DEFINITION);
    fixture.detectChanges();

    await expectNoAxeViolations(fixture.nativeElement);
  });
});
