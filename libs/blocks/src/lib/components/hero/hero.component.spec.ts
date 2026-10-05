// components/hero/hero.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { NovanAsset } from '@black-isle-beef/cms-angular';

import { CmsStylePanelComponent } from '../../cms-style-panel/cms-style-panel.component';
import { kebab, renderBlock, settingsVariants } from '../../../testing/cms-testing';
import { HeroBlock } from './hero.component';
import { HERO_DEFINITION } from './hero.definition';
import { HERO_SAMPLE_CONTENT, HERO_SCHEMA, type HeroFields } from './hero.schema';

const photo: NovanAsset = {
  id: '00000000-0000-4000-8000-000000000501',
  url: 'http://localhost:3000/v1/assets/00000000-0000-4000-8000-000000000501/salon.jpg?v=1',
  filename: 'salon.jpg',
  mime: 'image/jpeg',
  width: 2400,
  height: 1200,
  alt: 'A spaniel being dried in the salon',
  focal: null,
};

const render = (content: Partial<HeroFields> = HERO_SAMPLE_CONTENT, settings?: unknown) => renderBlock(HeroBlock, content, settings);

describe('HeroBlock', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HeroBlock, CmsStylePanelComponent], providers: [provideRouter([])] });
  });

  it('declares the block it renders', () => {
    expect(HeroBlock.novanBlock).toEqual({ apiId: 'hero', schemaVersion: 1 });
  });

  describe('content', () => {
    it('renders the heading, subheading and button', () => {
      const { host } = render();

      expect(host.querySelector('h1')?.textContent).toBe('Grooming that puts your dog first');
      expect(host.querySelector('.novan-hero-block__subheading')?.textContent).toContain('Calm, unhurried');
      const button = host.querySelector('a.btn');
      expect(button?.textContent?.trim()).toBe('Book an appointment');
      expect(button?.getAttribute('href')).toBe('https://example.com/book');
    });

    it('names the section by its heading', () => {
      const { host } = render();

      expect(host.querySelector('section')?.getAttribute('aria-labelledby')).toBe(host.querySelector('h1')?.id);
    });

    it('routes internal links through the router, with their anchor', () => {
      const { host } = render({
        ...HERO_SAMPLE_CONTENT,
        action: { type: 'internal', entryId: photo.id, path: '/about', anchor: 'team', text: 'Meet the team' },
      });

      expect(host.querySelector('a.btn')?.getAttribute('href')).toBe('/about#team');
    });

    it('renders the background image with the asset alt text, resized', () => {
      const { host } = render({ ...HERO_SAMPLE_CONTENT, image: photo });

      const img = host.querySelector('img');
      expect(img?.getAttribute('alt')).toBe('A spaniel being dried in the salon');
      expect(img?.getAttribute('src')).toContain('width=1920');
      expect(img?.getAttribute('width')).toBe('2400');
      expect(host.classList).toContain('novan-hero-block--has-image');
    });

    it('treats an image without alt text as decorative', () => {
      const { host } = render({ ...HERO_SAMPLE_CONTENT, image: { ...photo, alt: null } });

      expect(host.querySelector('img')?.getAttribute('alt')).toBe('');
    });

    it('leaves out what is missing, without empty wrappers', () => {
      const { host } = render({ heading: 'Only a heading' });

      expect(host.querySelector('img')).toBeNull();
      expect(host.querySelector('.novan-hero-block__subheading')).toBeNull();
      expect(host.querySelector('novan-block-action')).toBeNull();
      expect(host.classList).not.toContain('novan-hero-block--has-image');
    });

    it('does not show a button without text, or for an unpublished page', () => {
      const noText = render({ ...HERO_SAMPLE_CONTENT, action: { type: 'external', url: 'https://example.com' } }).host;
      const unpublished = render({
        ...HERO_SAMPLE_CONTENT,
        action: { type: 'internal', entryId: photo.id, path: null, text: 'Gone' },
      }).host;

      expect(noText.querySelector('a')).toBeNull();
      expect(unpublished.querySelector('a')).toBeNull();
    });

    it('drops an unsafe link address', () => {
      const { host } = render({ ...HERO_SAMPLE_CONTENT, action: { type: 'external', url: 'javascript:alert(1)', text: 'Click' } });

      expect(host.querySelector('a')).toBeNull();
    });

    it('has no heading or label when the heading is empty (a draft)', () => {
      const { host } = render({ heading: '   ', subheading: 'Text' });

      expect(host.querySelector('h1, h2')).toBeNull();
      expect(host.querySelector('section')?.hasAttribute('aria-labelledby')).toBe(false);
    });

    it('updates in place when content changes (live preview)', () => {
      const { fixture, host } = render({ heading: 'First' });

      fixture.componentRef.setInput('image', photo);
      fixture.componentRef.setInput('heading', 'Second');
      fixture.componentRef.setInput('subheading', 'Added');
      fixture.detectChanges();
      expect(host.querySelector('h1')?.textContent).toBe('Second');
      expect(host.querySelector('img')).not.toBeNull();
      expect(host.querySelector('.novan-hero-block__subheading')?.textContent).toBe('Added');

      fixture.componentRef.setInput('image', null);
      fixture.componentRef.setInput('heading', '');
      fixture.detectChanges();
      expect(host.querySelector('img')).toBeNull();
      expect(host.querySelector('section')?.hasAttribute('aria-labelledby')).toBe(false);
      expect(host.classList).not.toContain('novan-hero-block--has-image');
    });

    it('gives each instance a unique heading id', () => {
      expect(render().host.querySelector('h1')?.id).not.toBe(render().host.querySelector('h1')?.id);
    });
  });

  describe('settings', () => {
    it('applies the schema defaults when no settings are stored', () => {
      const { host } = render();

      expect(host.className.split(' ').sort()).toEqual(
        [
          'novan-hero-block',
          'novan-hero-block--tone-brand',
          'novan-hero-block--alignment-start',
          'novan-hero-block--height-standard',
          'novan-hero-block--heading-level-h1',
        ].sort(),
      );
    });

    it.each(settingsVariants(HERO_SCHEMA).filter((variant) => variant.key !== null))('applies $name', ({ key, value, settings }) => {
      const { host } = render(HERO_SAMPLE_CONTENT, settings);

      expect(host.classList).toContain(`novan-hero-block--${kebab(key as string)}-${String(value)}`);
    });

    it.each(['h1', 'h2'] as const)('renders the heading as %s', (headingLevel) => {
      const { host } = render(HERO_SAMPLE_CONTENT, { headingLevel });

      expect(host.querySelector(headingLevel)?.textContent).toBe('Grooming that puts your dog first');
      expect(host.querySelectorAll('h1, h2').length).toBe(1);
    });

    it.each([
      ['light', 'btn-hero-dark'],
      ['brand', 'btn-hero-light'],
      ['dark', 'btn-hero-light'],
    ])('on tone %s, uses the %s button', (tone, button) => {
      expect(render(HERO_SAMPLE_CONTENT, { tone }).host.querySelector('a.btn')?.classList).toContain(button);
    });

    it.each([
      ['unknown values', { tone: 'neon', height: 'huge' }],
      ['wrong types', { headingLevel: 1, alignment: true }],
      ['retired keys', { colour: 'red', legacyTheme: true }],
      ['null', null],
      ['an array', []],
    ])('falls back to defaults for %s', (_label, stored) => {
      const { host } = render(HERO_SAMPLE_CONTENT, stored);

      expect(host.classList).toContain('novan-hero-block--tone-brand');
      expect(host.classList).toContain('novan-hero-block--height-standard');
      expect(host.querySelector('h1')).not.toBeNull();
      expect(host.className).not.toMatch(/neon|huge|red|legacy/);
    });

    it('updates when settings change', () => {
      const { fixture, host } = render(HERO_SAMPLE_CONTENT, { tone: 'light' });

      fixture.componentRef.setInput('settings', { tone: 'dark', headingLevel: 'h2' });
      fixture.detectChanges();

      expect(host.classList).toContain('novan-hero-block--tone-dark');
      expect(host.classList).not.toContain('novan-hero-block--tone-light');
      expect(host.querySelector('h2')).not.toBeNull();
      expect(host.querySelector('h1')).toBeNull();
    });
  });

  describe('editor panel', () => {
    function renderPanel() {
      const fixture = TestBed.createComponent(CmsStylePanelComponent);
      fixture.componentRef.setInput('definition', HERO_DEFINITION);
      fixture.detectChanges();
      return { fixture, element: fixture.nativeElement as HTMLElement };
    }

    it('offers a control for every style option', () => {
      const { element } = renderPanel();
      const labels = Array.from(element.querySelectorAll('label, legend')).map((node) => node.textContent?.trim());

      for (const field of Object.values(HERO_SCHEMA)) {
        expect(labels).toContain(field.label);
      }
    });

    it('updates the live preview when an editor picks a tone', () => {
      const { fixture, element } = renderPanel();

      element.querySelector<HTMLInputElement>('input[type="radio"][value="dark"]')?.click();
      fixture.detectChanges();

      expect(element.querySelector('novan-hero-block')?.classList).toContain('novan-hero-block--tone-dark');
      expect(fixture.componentInstance.settings()).toMatchObject({ tone: 'dark' });
    });

    it('resets to the defaults', () => {
      const { fixture, element } = renderPanel();
      fixture.componentInstance.settings.set({ tone: 'light', height: 'tall' });
      fixture.detectChanges();

      element.querySelector<HTMLButtonElement>('.novan-style-panel__reset')?.click();
      fixture.detectChanges();

      expect(fixture.componentInstance.settings()).toEqual({ tone: 'brand', alignment: 'start', height: 'standard', headingLevel: 'h1' });
    });
  });
});
