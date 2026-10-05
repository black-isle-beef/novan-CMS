// components/cta/cta.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CmsStylePanelComponent } from '../../cms-style-panel/cms-style-panel.component';
import { kebab, renderBlock, settingsVariants } from '../../../testing/cms-testing';
import { CtaBlock } from './cta.component';
import { CTA_DEFINITION } from './cta.definition';
import { CTA_SAMPLE_CONTENT, CTA_SCHEMA, type CtaFields } from './cta.schema';

const render = (content: Partial<CtaFields> = CTA_SAMPLE_CONTENT, settings?: unknown) => renderBlock(CtaBlock, content, settings);

describe('CtaBlock', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CtaBlock, CmsStylePanelComponent], providers: [provideRouter([])] });
  });

  it('declares the block it renders', () => {
    expect(CtaBlock.novanBlock).toEqual({ apiId: 'cta', schemaVersion: 1 });
  });

  describe('content', () => {
    it('renders the heading, text and an email button', () => {
      const { host } = render();

      expect(host.querySelector('h2')?.textContent).toBe('Ready for a calmer grooming day?');
      expect(host.querySelector('.novan-cta-block__text')?.textContent).toContain('Tell us about your dog');
      const button = host.querySelector('a.btn');
      expect(button?.getAttribute('href')).toBe('mailto:hello@example.com');
      expect(button?.textContent?.trim()).toBe('Email us');
    });

    it('links to a page through the router', () => {
      const { host } = render({
        ...CTA_SAMPLE_CONTENT,
        action: { type: 'internal', entryId: '00000000-0000-4000-8000-000000000001', path: '/contact', text: 'Contact us' },
      });

      expect(host.querySelector('a.btn')?.getAttribute('href')).toBe('/contact');
    });

    it('names the section by its heading', () => {
      const { host } = render();

      expect(host.querySelector('section')?.getAttribute('aria-labelledby')).toBe(host.querySelector('h2')?.id);
    });

    it('leaves out what is missing, without empty wrappers', () => {
      const { host } = render({ heading: 'Only a heading', action: null });

      expect(host.querySelector('.novan-cta-block__text')).toBeNull();
      expect(host.querySelector('novan-block-action')).toBeNull();
    });

    it('updates in place when content changes (live preview)', () => {
      const { fixture, host } = render({ text: 'Text first' });
      expect(host.querySelector('h2')).toBeNull();
      expect(host.querySelector('section')?.hasAttribute('aria-labelledby')).toBe(false);

      fixture.componentRef.setInput('heading', 'Now a heading');
      fixture.componentRef.setInput('action', CTA_SAMPLE_CONTENT.action);
      fixture.detectChanges();
      expect(host.querySelector('section')?.getAttribute('aria-labelledby')).toBe(host.querySelector('h2')?.id);
      expect(host.querySelector('a.btn')).not.toBeNull();

      fixture.componentRef.setInput('action', null);
      fixture.detectChanges();
      expect(host.querySelector('a')).toBeNull();
    });
  });

  describe('settings', () => {
    it('applies the schema defaults when no settings are stored', () => {
      expect(render().host.className.split(' ').sort()).toEqual(
        ['novan-cta-block', 'novan-cta-block--tone-brand', 'novan-cta-block--alignment-center', 'novan-cta-block--heading-level-h2'].sort(),
      );
    });

    it.each(settingsVariants(CTA_SCHEMA).filter((variant) => variant.key !== null))('applies $name', ({ key, value, settings }) => {
      expect(render(CTA_SAMPLE_CONTENT, settings).host.classList).toContain(`novan-cta-block--${kebab(key as string)}-${String(value)}`);
    });

    it.each(['h2', 'h3', 'h4'] as const)('renders the heading as %s', (headingLevel) => {
      const { host } = render(CTA_SAMPLE_CONTENT, { headingLevel });

      expect(host.querySelector(headingLevel)?.textContent).toBe('Ready for a calmer grooming day?');
      expect(host.querySelectorAll('h2, h3, h4')).toHaveLength(1);
    });

    it.each([
      ['light', 'btn-hero-dark'],
      ['brand', 'btn-hero-light'],
      ['dark', 'btn-hero-light'],
    ])('on tone %s, uses the %s button', (tone, button) => {
      expect(render(CTA_SAMPLE_CONTENT, { tone }).host.querySelector('a.btn')?.classList).toContain(button);
    });

    it.each([
      ['unknown values', { tone: 'neon', alignment: 'justify' }],
      ['wrong types', { headingLevel: ['h3'] }],
      ['null', null],
    ])('falls back to defaults for %s', (_label, stored) => {
      const { host } = render(CTA_SAMPLE_CONTENT, stored);

      expect(host.classList).toContain('novan-cta-block--tone-brand');
      expect(host.classList).toContain('novan-cta-block--alignment-center');
      expect(host.querySelector('h2')).not.toBeNull();
    });

    it('updates when settings change', () => {
      const { fixture, host } = render();

      fixture.componentRef.setInput('settings', { tone: 'light', alignment: 'start' });
      fixture.detectChanges();

      expect(host.classList).toContain('novan-cta-block--tone-light');
      expect(host.classList).toContain('novan-cta-block--alignment-start');
      expect(host.querySelector('a.btn')?.classList).toContain('btn-hero-dark');
    });
  });

  describe('editor panel', () => {
    it('offers a control for every style option and updates the preview', () => {
      const fixture = TestBed.createComponent(CmsStylePanelComponent);
      fixture.componentRef.setInput('definition', CTA_DEFINITION);
      fixture.detectChanges();
      const element = fixture.nativeElement as HTMLElement;

      const labels = Array.from(element.querySelectorAll('label, legend')).map((node) => node.textContent?.trim());
      for (const field of Object.values(CTA_SCHEMA)) expect(labels).toContain(field.label);

      const select = element.querySelector<HTMLSelectElement>('select');
      if (select) {
        select.value = 'h4';
        select.dispatchEvent(new Event('change'));
      }
      fixture.detectChanges();
      expect(element.querySelector('novan-cta-block h4')).not.toBeNull();
      expect(fixture.componentInstance.settings()).toEqual({ tone: 'brand', alignment: 'center', headingLevel: 'h4' });
    });
  });
});
