// components/rich-text/rich-text.a11y.spec.ts
// axe-core in jsdom; colour contrast is covered by the starter site's Playwright axe tests.
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CmsStylePanelComponent } from '../../cms-style-panel/cms-style-panel.component';
import { expectNoAxeViolations, renderBlock, settingsVariants } from '../../../testing/cms-testing';
import { RichTextBlock } from './rich-text.component';
import { RICH_TEXT_DEFINITION } from './rich-text.definition';
import { RICH_TEXT_SAMPLE_CONTENT, RICH_TEXT_SCHEMA } from './rich-text.schema';

const render = (body: unknown = RICH_TEXT_SAMPLE_CONTENT.body, settings?: unknown) => renderBlock(RichTextBlock, { body }, settings).host;

describe('RichTextBlock accessibility', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [RichTextBlock, CmsStylePanelComponent], providers: [provideRouter([])] });
  });

  it('has no violations with default settings', async () => {
    await expectNoAxeViolations(render());
  });

  it.each(settingsVariants(RICH_TEXT_SCHEMA))('has no violations with $name', async ({ settings }) => {
    await expectNoAxeViolations(render(RICH_TEXT_SAMPLE_CONTENT.body, settings));
  });

  it('has no violations with a quote, an ordered list and long text', async () => {
    const long = 'We groom one dog at a time so the salon stays quiet and calm. '.repeat(20);
    await expectNoAxeViolations(
      render({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: long }] },
          { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Best groomer in town.' }] }] },
          {
            type: 'orderedList',
            content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Book' }] }] }],
          },
        ],
      }),
    );
  });

  it('has no violations in the editor panel', async () => {
    const fixture = TestBed.createComponent(CmsStylePanelComponent);
    fixture.componentRef.setInput('definition', RICH_TEXT_DEFINITION);
    fixture.detectChanges();

    await expectNoAxeViolations(fixture.nativeElement);
  });
});
