import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import axe from 'axe-core';
import { SITE_CONFIG, type SiteConfig } from '../config/site-config';
import { SiteLayout } from './site-layout';

@Component({ template: '<h1>Page</h1>' })
class StubPage {}

const config: SiteConfig = {
  siteUrl: 'https://novan.example',
  cmsLoginUrl: 'https://admin.novan.example/sign-in',
  contactForm: null,
};

async function render(path: string) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: '', component: SiteLayout, children: [{ path: '**', component: StubPage }] }]),
      { provide: SITE_CONFIG, useValue: config },
    ],
  });
  const harness = await RouterTestingHarness.create(path);
  harness.detectChanges();
  return harness.routeNativeElement as HTMLElement;
}

describe('SiteLayout', () => {
  it('links every page from the header and marks the current one', async () => {
    const root = await render('/pricing');
    const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Primary"] a'));

    expect(links.map((link) => [link.textContent?.trim(), link.getAttribute('href')])).toEqual([
      ['Home', '/'],
      ['Features', '/features'],
      ['Pricing', '/pricing'],
      ['Contact', '/contact'],
    ]);
    expect(links.filter((link) => link.getAttribute('aria-current') === 'page').map((link) => link.textContent?.trim())).toEqual(['Pricing']);
  });

  it('marks Home only on the home page', async () => {
    const root = await render('/features');
    const home = root.querySelector('nav[aria-label="Primary"] a[href="/"]');
    expect(home?.getAttribute('aria-current')).toBeNull();
  });

  it('sends Sign in to the CMS login URL from the environment, as a plain link', async () => {
    const root = await render('/');
    const signIn = Array.from(root.querySelectorAll<HTMLAnchorElement>('header a')).find((link) => link.textContent?.trim() === 'Sign in');

    expect(signIn?.getAttribute('href')).toBe('https://admin.novan.example/sign-in');
    expect(signIn?.hasAttribute('routerlink')).toBe(false);
  });

  it('has the skip link first, the call to action, and the footer with legal links and Cookie settings', async () => {
    const root = await render('/');

    expect(root.querySelector('a, button')?.textContent?.trim()).toBe('Skip to main content');
    expect(root.querySelector('header a.btn-primary')?.getAttribute('href')).toBe('/contact?enquiry=demo');
    const footer = root.querySelector('footer')!;
    const footerLinks = Array.from(footer.querySelectorAll('a')).map((link) => link.getAttribute('href'));
    expect(footerLinks).toEqual(expect.arrayContaining(['/features', '/pricing', '/contact', '/privacy', '/cookies', '/accessibility']));
    expect(footer.textContent).toContain(`© ${new Date().getFullYear()} Novan Web Services`);
    expect(Array.from(footer.querySelectorAll('button')).map((button) => button.textContent?.trim())).toContain('Cookie settings');
  });

  it('has no axe violations', async () => {
    const root = await render('/');
    const results = await axe.run(root, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
