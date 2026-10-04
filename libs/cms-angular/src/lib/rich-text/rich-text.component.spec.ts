import { ApplicationRef, ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { ProseMirrorNode } from '../types';
import { NovanRichText } from './rich-text.component';

@Component({
  imports: [NovanRichText],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<novan-rich-text [doc]="doc()" />`,
})
class Host {
  readonly doc = signal<unknown>(null);
}

function render(doc: unknown, { router = true } = {}): HTMLElement {
  TestBed.configureTestingModule({ providers: router ? [provideRouter([{ path: '**', children: [] }])] : [] });
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.doc.set(doc);
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).querySelector('novan-rich-text') as HTMLElement;
}

const doc = (...content: ProseMirrorNode[]): ProseMirrorNode => ({ type: 'doc', content });
const p = (...content: ProseMirrorNode[]): ProseMirrorNode => ({ type: 'paragraph', content });
const text = (value: string, marks: ProseMirrorNode['marks'] = []): ProseMirrorNode => ({ type: 'text', text: value, marks });
const link = (href: unknown, value = 'link'): ProseMirrorNode => text(value, [{ type: 'link', attrs: { href } }]);

/** The markup without Angular's comment anchors and attributes. */
function markup(el: HTMLElement): string {
  return el.innerHTML
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/ (ng-reflect-[\w-]+|_ngcontent-[\w-]+|ng-version)="[^"]*"/g, '');
}

describe('NovanRichText', () => {
  it('renders paragraphs, headings, lists, quotes, code and rules', () => {
    const el = render(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('Our story')] },
        p(text('Plain '), text('bold', [{ type: 'bold' }]), text(' and '), text('both', [{ type: 'italic' }, { type: 'underline' }])),
        { type: 'bulletList', content: [{ type: 'listItem', content: [p(text('One'))] }, { type: 'listItem', content: [p(text('Two'))] }] },
        { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [p(text('Three'))] }] },
        { type: 'blockquote', content: [p(text('Quoted'))] },
        { type: 'codeBlock', content: [text('const a = 1;')] },
        { type: 'horizontalRule' },
        p(text('Line'), { type: 'hardBreak' }, text('break')),
      ),
    );

    expect(markup(el)).toBe(
      '<h2>Our story</h2>' +
        '<p>Plain <strong>bold</strong> and <em><u>both</u></em></p>' +
        '<ul><li><p>One</p></li><li><p>Two</p></li></ul>' +
        '<ol start="3"><li><p>Three</p></li></ol>' +
        '<blockquote class="blockquote"><p>Quoted</p></blockquote>' +
        '<pre><code>const a = 1;</code></pre>' +
        '<hr>' +
        '<p>Line<br>break</p>',
    );
  });

  it('uses heading levels 1 to 6 and h2 for anything else', () => {
    const levels = [1, 3, 6, 0, 7, '1', 2.5];
    const el = render(doc(...levels.map((level) => ({ type: 'heading', attrs: { level }, content: [text('H')] }))));
    expect([...el.children].map((h) => h.tagName)).toEqual(['H1', 'H3', 'H6', 'H2', 'H2', 'H2', 'H2']);
  });

  it('routes site links and opens other links as they are', async () => {
    const el = render(
      doc(p(link('/about#team', 'About'), text(' '), link('https://example.com/x?y=1', 'Out'), text(' '), link('mailto:hi@example.com', 'Mail'))),
    );

    const [about, out, mail] = [...el.querySelectorAll('a')];
    expect(about.getAttribute('href')).toBe('/about#team');
    about.click();
    await TestBed.inject(ApplicationRef).whenStable();
    expect(TestBed.inject(Router).url).toBe('/about#team');
    expect(out.getAttribute('href')).toBe('https://example.com/x?y=1');
    expect(mail.getAttribute('href')).toBe('mailto:hi@example.com');
  });

  it('uses the current path of an internal link to a page, and drops links to unpublished pages', () => {
    const el = render(
      doc(
        p(text('Live', [{ type: 'link', attrs: { entryId: 'e1', path: '/contact', href: 'https://stale.example.com' } }])),
        p(text('Draft', [{ type: 'link', attrs: { entryId: 'e2', path: null } }])),
      ),
    );

    expect(el.querySelector('a')?.getAttribute('href')).toBe('/contact');
    expect(el.querySelectorAll('a')).toHaveLength(1);
    expect(el.textContent).toContain('Draft');
  });

  it('renders site links as plain links in an app without a router', () => {
    const el = render(doc(p(link('/about', 'About'))), { router: false });
    expect(el.querySelector('a')?.getAttribute('href')).toBe('/about');
  });

  it('renders embedded images with alt text', () => {
    const el = render(
      doc(
        { type: 'image', attrs: { src: 'https://cdn.example.com/a.png', alt: 'A chart', width: 640, height: 480 } },
        {
          type: 'image',
          attrs: { asset: { id: 'x', url: 'https://api.example.com/v1/assets/x/b.png?v=1', alt: 'From the library', width: 10, height: 20 } },
        },
        { type: 'image', attrs: { src: '/local.png' } },
      ),
    );

    const images = [...el.querySelectorAll('img')];
    expect(images.map((img) => [img.getAttribute('src'), img.getAttribute('alt'), img.getAttribute('width')])).toEqual([
      ['https://cdn.example.com/a.png', 'A chart', '640'],
      ['https://api.example.com/v1/assets/x/b.png?v=1', 'From the library', '10'],
      ['/local.png', '', null],
    ]);
  });

  it('renders nothing for a value that is not rich text', () => {
    for (const value of [null, undefined, 'text', 42, [], { content: [] }]) {
      TestBed.resetTestingModule();
      expect(markup(render(value))).toBe('');
    }
  });

  describe('XSS', () => {
    const unsafeHrefs = [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'javascript&colon;alert(1)',
      '&#106;avascript:alert(1)',
      'jav&#x09;ascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'vbscript:msgbox(1)',
      '//evil.example.com',
      '/\\evil.example.com',
      'file:///etc/passwd',
      { toString: () => 'javascript:alert(1)' },
      ['javascript:alert(1)'],
    ];

    it.each(unsafeHrefs.map((href) => [String(href), href]))('renders the text of a %s link without the link', (_, href) => {
      const el = render(doc(p(link(href, 'Click me'))));
      expect(el.querySelector('a')).toBeNull();
      expect(el.textContent).toBe('Click me');
    });

    it('never creates script, iframe or other unknown elements', () => {
      const el = render(
        doc(
          { type: 'script', content: [text('alert(1)')] },
          { type: 'iframe', attrs: { src: 'https://evil.example.com' } },
          { type: 'paragraph', content: [{ type: 'img', attrs: { src: 'x', onerror: 'alert(1)' } }] },
          { type: 'html', attrs: { html: '<img src=x onerror=alert(1)>' } },
          { type: 'object', attrs: { data: 'javascript:alert(1)' } },
        ),
      );

      expect(el.querySelector('script, iframe, object, embed, img, html')).toBeNull();
      expect(markup(el)).toBe('alert(1)<p></p>');
    });

    it('renders markup in text as text', () => {
      const el = render(doc(p(text('<script>alert(1)</script><img src=x onerror=alert(1)>'))));
      expect(el.querySelector('script, img')).toBeNull();
      expect(el.querySelector('p')?.textContent).toBe('<script>alert(1)</script><img src=x onerror=alert(1)>');
    });

    it('drops event handler and other attributes on every node and mark', () => {
      const evil = { onclick: 'alert(1)', onmouseover: 'alert(1)', style: 'background:url(javascript:alert(1))', class: 'x', id: 'x', srcdoc: '<script>' };
      const el = render(
        doc(
          { type: 'paragraph', attrs: evil, content: [text('P', [{ type: 'bold', attrs: evil }])] },
          { type: 'heading', attrs: { level: 2, ...evil }, content: [text('H')] },
          { type: 'orderedList', attrs: { start: '1" onclick="alert(1)', ...evil }, content: [{ type: 'listItem', attrs: evil, content: [p(text('L'))] }] },
          p(text('A', [{ type: 'link', attrs: { href: 'https://example.com', target: '_blank', ...evil } }])),
          { type: 'image', attrs: { src: 'https://example.com/i.png', alt: 'I', ...evil, onerror: 'alert(1)', onload: 'alert(1)' } },
        ),
      );

      for (const element of [el, ...el.querySelectorAll('*')]) {
        for (const attribute of [...element.attributes]) {
          expect(attribute.name).not.toMatch(/^on|^style$|^srcdoc$|^target$/);
          expect(attribute.value).not.toMatch(/alert|javascript/i);
        }
      }
      expect(el.querySelector('ol')?.hasAttribute('start')).toBe(false);
    });

    it('refuses images from unsafe addresses', () => {
      const sources = ['javascript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>', '//evil.example.com/x.png', 'x.png'];
      const el = render(doc(...sources.map((src) => ({ type: 'image', attrs: { src, alt: 'x' } }))));
      expect(el.querySelector('img')).toBeNull();
      TestBed.resetTestingModule();
      const fromAsset = render(doc({ type: 'image', attrs: { asset: { url: 'javascript:alert(1)' }, src: 'https://ok.example.com/a.png' } }));
      expect(fromAsset.querySelector('img')).toBeNull();
    });

    it('survives deeply nested content', () => {
      let node: ProseMirrorNode = text('deep');
      for (let i = 0; i < 5000; i++) node = { type: 'blockquote', content: [node] };
      expect(() => render(doc(node))).not.toThrow();
    });
  });
});
