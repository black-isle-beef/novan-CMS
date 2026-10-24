import { TestBed } from '@angular/core/testing';
import { provideRouter, TitleStrategy, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appRoutes } from './app.routes';
import { SeoTitleStrategy } from './seo/seo-title-strategy';

describe('App routes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      // As app.config.ts: route data and query parameters reach pages as inputs.
      providers: [provideRouter(appRoutes, withComponentInputBinding()), { provide: TitleStrategy, useClass: SeoTitleStrategy }],
    });
  });

  const pages = [
    ['/', 'Websites your clients can run themselves', 'Novan CMS: a simple CMS your clients can run themselves'],
    ['/features', 'Features', 'Features | Novan CMS'],
    ['/pricing', 'Pricing', 'Pricing | Novan CMS'],
    ['/contact', 'Contact us', 'Contact us | Novan CMS'],
    ['/privacy', 'Privacy policy', 'Privacy policy | Novan CMS'],
    ['/cookies', 'Cookie policy', 'Cookie policy | Novan CMS'],
    ['/accessibility', 'Accessibility statement', 'Accessibility statement | Novan CMS'],
    ['/no-such-page', 'We could not find that page', 'Page not found | Novan CMS'],
  ] as const;

  for (const [path, heading, title] of pages) {
    it(`renders ${path} inside the layout, with one h1 and its title`, async () => {
      const harness = await RouterTestingHarness.create(path);
      const root = harness.routeNativeElement as HTMLElement;

      expect(root.querySelector('main#ds-main-content')).not.toBeNull();
      expect(root.querySelectorAll('h1')).toHaveLength(1);
      expect(root.querySelector('h1')?.textContent?.trim()).toBe(heading);
      expect(document.title).toBe(title);
    });
  }
});
