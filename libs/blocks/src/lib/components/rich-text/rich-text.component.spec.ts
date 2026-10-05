// components/rich-text/rich-text.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { ProseMirrorNode } from '@black-isle-beef/cms-angular';

import { CmsStylePanelComponent } from '../../cms-style-panel/cms-style-panel.component';
import { kebab, renderBlock, settingsVariants } from '../../../testing/cms-testing';
import { RichTextBlock } from './rich-text.component';
import { RICH_TEXT_DEFINITION } from './rich-text.definition';
import { RICH_TEXT_SAMPLE_CONTENT, RICH_TEXT_SCHEMA } from './rich-text.schema';

const paragraph = (text: string): ProseMirrorNode => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const render = (body: unknown = RICH_TEXT_SAMPLE_CONTENT.body, settings?: unknown) => renderBlock(RichTextBlock, { body }, settings);

describe('RichTextBlock', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [RichTextBlock, CmsStylePanelComponent], providers: [provideRouter([])] });
  });

  it('declares the block it renders', () => {
    expect(RichTextBlock.novanBlock).toEqual({ apiId: 'richText', schemaVersion: 1 });
  });

  describe('content', () => {
    it('renders the document: headings, formatting, links and lists', () => {
      const { host } = render();

      expect(host.querySelector('h2')?.textContent).toBe('How we work');
      expect(host.querySelector('strong')?.textContent).toBe('ten-minute settling-in');
      expect(host.querySelector('a')?.getAttribute('href')).toBe('/guide');
      expect(host.querySelectorAll('ul li')).toHaveLength(2);
    });

    it('drops unsafe content (the SDK renderer, never innerHTML)', () => {
      const { host } = render({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Click', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] },
          { type: 'script', content: [{ type: 'text', text: 'alert(1)' }] },
        ],
      });

      expect(host.querySelector('a')).toBeNull();
      expect(host.querySelector('script')).toBeNull();
      expect(host.textContent).toContain('Click');
    });

    it.each([
      ['null', null],
      ['an empty document', { type: 'doc', content: [] }],
      ['not a document', 'plain text'],
    ])('renders nothing for %s', (_label, body) => {
      const { host } = render(body);

      expect(host.children).toHaveLength(0);
      expect(host.classList).toContain('novan-rich-text-block--empty');
    });

    it('updates in place when the text changes (live preview)', () => {
      const { fixture, host } = render(paragraph('First draft'));

      fixture.componentRef.setInput('body', paragraph('Edited'));
      fixture.detectChanges();
      expect(host.textContent?.trim()).toBe('Edited');

      fixture.componentRef.setInput('body', null);
      fixture.detectChanges();
      expect(host.children).toHaveLength(0);

      fixture.componentRef.setInput('body', paragraph('Back again'));
      fixture.detectChanges();
      expect(host.textContent?.trim()).toBe('Back again');
      expect(host.classList).not.toContain('novan-rich-text-block--empty');
    });
  });

  describe('settings', () => {
    it('applies the schema defaults when no settings are stored', () => {
      expect(render().host.className.split(' ').sort()).toEqual(
        ['novan-rich-text-block', 'novan-rich-text-block--tone-light', 'novan-rich-text-block--width-narrow'].sort(),
      );
    });

    it.each(settingsVariants(RICH_TEXT_SCHEMA).filter((variant) => variant.key !== null))('applies $name', ({ key, value, settings }) => {
      expect(render(RICH_TEXT_SAMPLE_CONTENT.body, settings).host.classList).toContain(
        `novan-rich-text-block--${kebab(key as string)}-${String(value)}`,
      );
    });

    it.each([
      ['unknown values', { tone: 'neon', width: 'huge' }],
      ['wrong types', { tone: 1, width: false }],
      ['null', null],
    ])('falls back to defaults for %s', (_label, stored) => {
      const { host } = render(RICH_TEXT_SAMPLE_CONTENT.body, stored);

      expect(host.classList).toContain('novan-rich-text-block--tone-light');
      expect(host.classList).toContain('novan-rich-text-block--width-narrow');
      expect(host.className).not.toMatch(/neon|huge/);
    });

    it('updates when settings change', () => {
      const { fixture, host } = render(RICH_TEXT_SAMPLE_CONTENT.body, { tone: 'light' });

      fixture.componentRef.setInput('settings', { tone: 'brand', width: 'wide' });
      fixture.detectChanges();

      expect(host.classList).toContain('novan-rich-text-block--tone-brand');
      expect(host.classList).toContain('novan-rich-text-block--width-wide');
      expect(host.classList).not.toContain('novan-rich-text-block--tone-light');
    });
  });

  describe('editor panel', () => {
    it('offers a control for every style option and updates the preview', () => {
      const fixture = TestBed.createComponent(CmsStylePanelComponent);
      fixture.componentRef.setInput('definition', RICH_TEXT_DEFINITION);
      fixture.detectChanges();
      const element = fixture.nativeElement as HTMLElement;

      const labels = Array.from(element.querySelectorAll('label, legend')).map((node) => node.textContent?.trim());
      for (const field of Object.values(RICH_TEXT_SCHEMA)) expect(labels).toContain(field.label);

      element.querySelector<HTMLInputElement>('input[type="radio"][value="wide"]')?.click();
      fixture.detectChanges();
      expect(element.querySelector('novan-rich-text-block')?.classList).toContain('novan-rich-text-block--width-wide');
      expect(fixture.componentInstance.settings()).toEqual({ width: 'wide', tone: 'light' });
    });
  });
});
