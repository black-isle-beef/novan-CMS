// components/custom-html/custom-html.component.spec.ts
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NOVAN_BLOCK_CONTEXT, NovanPreview } from '@black-isle-beef/cms-angular';

import { CmsStylePanelComponent } from '../../cms-style-panel/cms-style-panel.component';
import { kebab, renderBlock, settingsVariants } from '../../../testing/cms-testing';
import { CustomHtmlBlock } from './custom-html.component';
import { CUSTOM_HTML_PREVIEW_STYLE, scopedCustomCss } from './custom-html.css';
import { CUSTOM_HTML_DEFINITION } from './custom-html.definition';
import { CUSTOM_HTML_SAMPLE_CONTENT, CUSTOM_HTML_SCHEMA } from './custom-html.schema';

const UID = '00000000-0000-4000-8000-000000000001';
const render = (content: object = CUSTOM_HTML_SAMPLE_CONTENT, settings?: unknown) => renderBlock(CustomHtmlBlock, content, settings);
const previewStyles = () => document.head.querySelectorAll<HTMLStyleElement>(`style[${CUSTOM_HTML_PREVIEW_STYLE}]`);

describe('CustomHtmlBlock', () => {
  afterEach(() => previewStyles().forEach((style) => style.remove()));

  describe('outside preview', () => {
    beforeEach(() => {
      TestBed.configureTestingModule({ imports: [CustomHtmlBlock, CmsStylePanelComponent], providers: [provideRouter([])] });
    });

    it('declares the block it renders', () => {
      expect(CustomHtmlBlock.novanBlock).toEqual({ apiId: 'customHtml', schemaVersion: 1 });
    });

    describe('content', () => {
      it('renders the markup', () => {
        const { host } = render();

        expect(host.querySelector('.opening-hours h2')?.textContent).toBe('Opening hours');
        expect(host.querySelectorAll('dl dt')).toHaveLength(2);
      });

      it('removes scripts, event handlers, frames, forms, ids, style attributes and unsafe links', () => {
        const { host } = render({
          html: [
            '<p class="note" id="note" onclick="alert(1)" style="color: red">Hello</p>',
            '<script>alert(1)</script>',
            '<style>body { display: none; }</style>',
            '<iframe src="https://example.com"></iframe>',
            '<form action="https://example.com"><input name="card"></form>',
            '<a href="javascript:alert(1)">Bad</a><a href="/good">Good</a>',
            '<img src="x" onerror="alert(1)" alt="">',
          ].join(''),
        });
        const content = host.querySelector('.novan-custom-html-block__content') as HTMLElement;

        const note = content.querySelector('p');
        expect(note?.className).toBe('note');
        // Ids could clobber the page's globals and clash with the site's own; classes do the same job here.
        expect(note?.hasAttribute('id')).toBe(false);
        expect(note?.hasAttribute('onclick')).toBe(false);
        expect(note?.hasAttribute('style')).toBe(false);
        expect(content.querySelector('script, style, iframe, form, input')).toBeNull();
        expect(content.querySelector('img')?.hasAttribute('onerror')).toBe(false);
        const links = Array.from(content.querySelectorAll('a')).map((link) => link.getAttribute('href'));
        expect(links[0]).toMatch(/^unsafe:/);
        expect(links[1]).toBe('/good');
      });

      it.each([
        ['null', null],
        ['blank markup', '  \n '],
        ['not text', 42],
      ])('renders nothing for %s', (_label, html) => {
        const { host } = render({ html });

        expect(host.children).toHaveLength(0);
        expect(host.classList).toContain('novan-custom-html-block--empty');
      });

      it('updates in place when the markup changes (live preview)', () => {
        const { fixture, host } = render({ html: '<p>First draft</p>' });

        fixture.componentRef.setInput('html', '<p>Edited</p>');
        fixture.detectChanges();
        expect(host.textContent?.trim()).toBe('Edited');

        fixture.componentRef.setInput('html', null);
        fixture.detectChanges();
        expect(host.children).toHaveLength(0);

        fixture.componentRef.setInput('html', '<p>Back again</p>');
        fixture.detectChanges();
        expect(host.textContent?.trim()).toBe('Back again');
        expect(host.classList).not.toContain('novan-custom-html-block--empty');
      });

      it('has no scope and adds no styles outside <novan-blocks> and preview', () => {
        const { host } = render();

        expect(host.hasAttribute('data-novan-custom-html')).toBe(false);
        expect(previewStyles()).toHaveLength(0);
      });
    });

    describe('settings', () => {
      it('applies the schema defaults when no settings are stored', () => {
        expect(render().host.className.split(' ').sort()).toEqual(['novan-custom-html-block', 'novan-custom-html-block--width-contained']);
      });

      it.each(settingsVariants(CUSTOM_HTML_SCHEMA).filter((variant) => variant.key !== null))('applies $name', ({ key, value, settings }) => {
        expect(render(CUSTOM_HTML_SAMPLE_CONTENT, settings).host.classList).toContain(
          `novan-custom-html-block--${kebab(key as string)}-${String(value)}`,
        );
      });

      it.each([
        ['unknown values', { width: 'huge', tone: 'neon' }],
        ['wrong types', { width: 3 }],
        ['null', null],
      ])('falls back to defaults for %s', (_label, stored) => {
        const { host } = render(CUSTOM_HTML_SAMPLE_CONTENT, stored);

        expect(host.classList).toContain('novan-custom-html-block--width-contained');
        expect(host.className).not.toMatch(/neon|huge/);
      });

      it('updates when settings change', () => {
        const { fixture, host } = render(CUSTOM_HTML_SAMPLE_CONTENT, { width: 'contained' });

        fixture.componentRef.setInput('settings', { width: 'full' });
        fixture.detectChanges();

        expect(host.classList).toContain('novan-custom-html-block--width-full');
        expect(host.classList).not.toContain('novan-custom-html-block--width-contained');
      });
    });

    describe('editor panel', () => {
      it('offers a control for every style option and updates the preview', () => {
        const fixture = TestBed.createComponent(CmsStylePanelComponent);
        fixture.componentRef.setInput('definition', CUSTOM_HTML_DEFINITION);
        fixture.detectChanges();
        const element = fixture.nativeElement as HTMLElement;

        const labels = Array.from(element.querySelectorAll('label, legend')).map((node) => node.textContent?.trim());
        for (const field of Object.values(CUSTOM_HTML_SCHEMA)) expect(labels).toContain(field.label);

        element.querySelector<HTMLInputElement>('input[type="radio"][value="full"]')?.click();
        fixture.detectChanges();
        expect(element.querySelector('novan-custom-html-block')?.classList).toContain('novan-custom-html-block--width-full');
        expect(fixture.componentInstance.settings()).toEqual({ width: 'full' });
      });
    });
  });

  describe('in a page', () => {
    const active = signal(false);

    beforeEach(() => {
      active.set(false);
      TestBed.configureTestingModule({
        imports: [CustomHtmlBlock],
        providers: [
          { provide: NOVAN_BLOCK_CONTEXT, useValue: { uid: UID, block: 'customHtml', entryId: null } },
          { provide: NovanPreview, useValue: { active } },
        ],
      });
    });

    it('marks its host with its _uid, which its CSS is scoped to', () => {
      expect(render().host.getAttribute('data-novan-custom-html')).toBe(UID);
    });

    it('leaves the CSS to the site stylesheet on published pages', () => {
      render();

      expect(previewStyles()).toHaveLength(0);
    });

    it('in preview, adds its scoped CSS to <head> and follows the editor', () => {
      active.set(true);
      const { fixture } = render();

      expect([...previewStyles()].map((style) => [style.getAttribute(CUSTOM_HTML_PREVIEW_STYLE), style.textContent])).toEqual([
        [UID, scopedCustomCss(UID, CUSTOM_HTML_SAMPLE_CONTENT.css)],
      ]);

      fixture.componentRef.setInput('css', 'h2 { color: green; }');
      fixture.detectChanges();
      expect(previewStyles()).toHaveLength(1);
      expect(previewStyles()[0].textContent).toBe(scopedCustomCss(UID, 'h2 { color: green; }'));

      fixture.componentRef.setInput('css', '');
      fixture.detectChanges();
      expect(previewStyles()).toHaveLength(0);

      fixture.componentRef.setInput('css', 'h2 { color: blue; }');
      fixture.detectChanges();
      expect(previewStyles()[0].textContent).toContain('color: blue');
    });

    it('in preview, drops CSS whose braces would escape the block', () => {
      active.set(true);
      render({ ...CUSTOM_HTML_SAMPLE_CONTENT, css: '} body { display: none; } .a {' });

      expect(previewStyles()).toHaveLength(0);
    });

    it("in preview, takes over the server's <style> after hydration instead of adding another", () => {
      active.set(true);
      const server = document.createElement('style');
      server.setAttribute(CUSTOM_HTML_PREVIEW_STYLE, UID);
      server.textContent = 'stale';
      document.head.appendChild(server);

      render();

      expect(previewStyles()).toHaveLength(1);
      expect(previewStyles()[0]).toBe(server);
      expect(server.textContent).toBe(scopedCustomCss(UID, CUSTOM_HTML_SAMPLE_CONTENT.css));
    });

    it('removes its <style> when it leaves the page', () => {
      active.set(true);
      const { fixture } = render();
      expect(previewStyles()).toHaveLength(1);

      fixture.destroy();

      expect(previewStyles()).toHaveLength(0);
    });
  });
});
