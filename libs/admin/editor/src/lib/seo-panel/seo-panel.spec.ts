import { TestBed } from '@angular/core/testing';
import { FieldFormContext, type MediaPreview } from '@novan/admin-fields';
import { fieldListSchema } from '@novan/shared-schemas';
import { SeoPanel } from './seo-panel';

const [seoField] = fieldListSchema.parse([
  {
    id: 'seo',
    apiId: 'seo',
    label: 'SEO',
    type: 'group',
    fields: [
      { id: 'metaTitle', apiId: 'metaTitle', label: 'Search title', type: 'text', max: 60 },
      { id: 'metaDescription', apiId: 'metaDescription', label: 'Search description', type: 'text', multiline: true, max: 160 },
      { id: 'noindex', apiId: 'noindex', label: 'Hide from search engines', type: 'boolean' },
    ],
  },
]);

const preview = (id: string, alt: string): MediaPreview => ({ id, filename: `${id}.jpg`, title: null, kind: 'image', alt, thumbnailUrl: `blob:${id}` });

function render(inputs: Partial<{ value: unknown; field: unknown; pageTitle: string; path: string }> = {}) {
  TestBed.configureTestingModule({ providers: [FieldFormContext] });
  const context = TestBed.inject(FieldFormContext);
  context.assets.set(new Map([['site', preview('site', 'Our office')], ['own', preview('own', 'The team')]]));
  const fixture = TestBed.createComponent(SeoPanel);
  fixture.componentRef.setInput('field', 'field' in inputs ? inputs.field : seoField);
  fixture.componentRef.setInput('value', inputs.value ?? {});
  fixture.componentRef.setInput('pageTitle', inputs.pageTitle ?? 'About us');
  fixture.componentRef.setInput('path', inputs.path ?? '/company/about');
  fixture.componentRef.setInput('siteUrl', 'https://www.example.com');
  fixture.componentRef.setInput('defaults', { siteName: 'Example', shareImageId: 'site' });
  fixture.detectChanges();
  const changes: Record<string, unknown>[] = [];
  fixture.componentInstance.valueChange.subscribe((value) => changes.push(value));
  return { fixture, el: fixture.nativeElement as HTMLElement, changes };
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();

describe('SeoPanel', () => {
  it('previews the search result from the page title and the site, with what is missing said plainly', () => {
    const { el } = render();
    const result = el.querySelector('.nv-seo-result');

    expect(text(result?.querySelector('.nv-seo-result-address'))).toBe('www.example.com › company › about');
    expect(text(result?.querySelector('.nv-seo-result-title'))).toBe('About us | Example');
    expect(text(result)).toContain('No search description');
    // The site's sharing image, said to be the site's.
    expect(el.querySelector<HTMLImageElement>('.nv-seo-card img')?.getAttribute('src')).toBe('blob:site');
    expect(text(el)).toContain("The site's sharing image");
  });

  it("uses the page's own search title, description and image, shortening long ones as results do", () => {
    const long = 'A description that goes on and on '.repeat(8);
    const { el } = render({ value: { metaTitle: 'Meet the team', metaDescription: long, ogImage: { assetId: 'own' } } });

    expect(text(el.querySelector('.nv-seo-result-title'))).toBe('Meet the team | Example');
    const description = text(el.querySelector('.nv-seo-result p:last-child')) ?? '';
    expect(description.endsWith('…')).toBe(true);
    expect([...description].length).toBeLessThanOrEqual(160);
    expect(el.querySelector<HTMLImageElement>('.nv-seo-card img')?.alt).toBe('The team');
    expect(text(el)).not.toContain("The site's sharing image");
  });

  it('says when the page is hidden from search engines', () => {
    const { el } = render({ value: { noindex: true } });

    expect(el.querySelector('.nv-seo-result')).toBeNull();
    expect(text(el)).toContain('Hidden from search engines');
  });

  it('edits the fields with character counts, and sends the whole group on', () => {
    const { el, changes } = render({ value: { metaTitle: 'Old' } });
    const input = el.querySelector<HTMLInputElement>('#field-seo-metaTitle');

    expect(text(el.querySelector('#field-seo-metaTitle-count'))).toBe('3 of 60 characters');
    expect(input?.getAttribute('aria-describedby')).toContain('field-seo-metaTitle-count');
    input!.value = 'New title';
    input!.dispatchEvent(new Event('input'));

    expect(changes).toEqual([{ metaTitle: 'New title' }]);
  });

  it('explains when the page type has no search settings', () => {
    const { el } = render({ field: undefined });

    expect(text(el)).toContain('no search settings');
  });
});
