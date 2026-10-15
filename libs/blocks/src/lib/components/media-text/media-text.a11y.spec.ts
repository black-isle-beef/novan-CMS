// components/media-text/media-text.a11y.spec.ts
// axe-core in jsdom; colour contrast is covered by the starter site's Playwright axe tests.
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { NovanAsset } from '@black-isle-beef/cms-angular';

import { CmsStylePanelComponent } from '../../cms-style-panel/cms-style-panel.component';
import { expectNoAxeViolations, renderBlock, settingsVariants } from '../../../testing/cms-testing';
import { MediaTextBlock } from './media-text.component';
import { MEDIA_TEXT_DEFINITION } from './media-text.definition';
import { MEDIA_TEXT_SAMPLE_CONTENT, MEDIA_TEXT_SCHEMA, type MediaTextFields } from './media-text.schema';

const photo = MEDIA_TEXT_SAMPLE_CONTENT.image as NovanAsset;
const render = (content: Partial<MediaTextFields> = MEDIA_TEXT_SAMPLE_CONTENT, settings?: unknown) =>
  renderBlock(MediaTextBlock, content, settings).host;

describe('MediaTextBlock accessibility', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [MediaTextBlock, CmsStylePanelComponent],
      providers: [provideRouter([])],
    });
  });

  it('has no violations with default settings', async () => {
    await expectNoAxeViolations(render());
  });

  it.each(settingsVariants(MEDIA_TEXT_SCHEMA))('has no violations with $name', async ({ settings }) => {
    await expectNoAxeViolations(render(MEDIA_TEXT_SAMPLE_CONTENT, settings));
  });

  it('has no violations with a decorative image, no heading and no button', async () => {
    await expectNoAxeViolations(render({ text: 'Text only.', image: { ...photo, alt: null } }));
  });

  it('has no violations with the longest text', async () => {
    const long = 'Gentle hand-scissoring for anxious dogs who do not like the sound of clippers. ';
    await expectNoAxeViolations(
      render({
        ...MEDIA_TEXT_SAMPLE_CONTENT,
        heading: long.repeat(2).slice(0, 120),
        text: `${long.repeat(6)}\n\n${long.repeat(6)}`.slice(0, 1000),
      }),
    );
  });

  it('has no violations in the editor panel', async () => {
    const fixture = TestBed.createComponent(CmsStylePanelComponent);
    fixture.componentRef.setInput('definition', MEDIA_TEXT_DEFINITION);
    fixture.detectChanges();

    await expectNoAxeViolations(fixture.nativeElement);
  });
});
