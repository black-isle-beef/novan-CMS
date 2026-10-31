// components/custom-html/custom-html.a11y.spec.ts
// axe-core in jsdom; colour contrast is covered by the starter site's Playwright axe tests. What the markup says is the
// author's to get right: these check the block adds no problems of its own around well-formed markup.
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CmsStylePanelComponent } from '../../cms-style-panel/cms-style-panel.component';
import { expectNoAxeViolations, renderBlock, settingsVariants } from '../../../testing/cms-testing';
import { CustomHtmlBlock } from './custom-html.component';
import { CUSTOM_HTML_DEFINITION } from './custom-html.definition';
import { CUSTOM_HTML_SAMPLE_CONTENT, CUSTOM_HTML_SCHEMA } from './custom-html.schema';

const render = (content: object = CUSTOM_HTML_SAMPLE_CONTENT, settings?: unknown) => renderBlock(CustomHtmlBlock, content, settings).host;

describe('CustomHtmlBlock accessibility', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CustomHtmlBlock, CmsStylePanelComponent], providers: [provideRouter([])] });
  });

  it('has no violations with default settings', async () => {
    await expectNoAxeViolations(render());
  });

  it.each(settingsVariants(CUSTOM_HTML_SCHEMA))('has no violations with $name', async ({ settings }) => {
    await expectNoAxeViolations(render(CUSTOM_HTML_SAMPLE_CONTENT, settings));
  });

  it('has no violations with a decorative image, a link and long text', async () => {
    const long = 'We groom one dog at a time so the salon stays quiet and calm. '.repeat(20);
    await expectNoAxeViolations(
      render({ html: `<figure><img src="/paw.svg" alt=""><figcaption>${long}</figcaption></figure><p><a href="/book">Book a visit</a></p>` }),
    );
  });

  it('has no violations once unsafe content is removed', async () => {
    await expectNoAxeViolations(render({ html: '<p onclick="alert(1)">Hello</p><script>alert(1)</script><iframe src="https://example.com"></iframe>' }));
  });

  it('has no violations in the editor panel', async () => {
    const fixture = TestBed.createComponent(CmsStylePanelComponent);
    fixture.componentRef.setInput('definition', CUSTOM_HTML_DEFINITION);
    fixture.detectChanges();

    await expectNoAxeViolations(fixture.nativeElement);
  });
});
