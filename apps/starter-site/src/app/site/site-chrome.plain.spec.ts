import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import axe from 'axe-core';
import { SiteChrome } from './site-chrome.plain';

describe('SiteChrome (plain)', () => {
  async function render(overrides: Record<string, unknown> = {}) {
    TestBed.configureTestingModule({ imports: [SiteChrome], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(SiteChrome);
    const inputs = {
      siteName: 'Acme',
      organisationName: 'Acme Ltd',
      navItems: [
        { label: 'About', href: '/about', active: true, children: [{ label: 'Team', href: '/about/team' }] },
        { label: 'Shop', href: 'https://shop.example/' },
      ],
      footerGroups: [{ title: 'Company', links: [{ label: 'Contact', href: '/contact' }] }],
      logo: null,
      contact: { email: 'hi@example.com', phone: '01234', tel: 'tel:01234', address: ['1 High Street'] },
      social: [{ label: 'Instagram', href: 'https://instagram.example/acme' }],
      ...overrides,
    };
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('has none of the design system or Bootstrap in its markup', async () => {
    const el = await render();

    expect(el.querySelector('ds-header, ds-footer')).toBeNull();
    expect(el.innerHTML).not.toMatch(/class="[^"]*\b(navbar|d-flex|list-unstyled|mb-0)\b/);
  });

  it('marks the current page and keeps a skip link to main', async () => {
    const el = await render();

    expect(el.querySelector('nav [aria-current="page"]')?.textContent).toBe('About');
    expect(el.querySelector('a[href="#ds-main-content"]')?.textContent).toBe('Skip to main content');
  });

  it('shows sub-items, the footer links, the contact details and social links', async () => {
    const text = (await render()).textContent;

    for (const expected of ['Team', 'Contact', 'hi@example.com', '1 High Street', 'Instagram', 'Acme Ltd']) expect(text).toContain(expected);
  });

  it('routes paths on the site and leaves other addresses as ordinary links', async () => {
    const el = await render();
    const shop = [...el.querySelectorAll('a')].find((link) => link.textContent === 'Shop');

    expect(shop?.getAttribute('href')).toBe('https://shop.example/');
    expect(el.querySelector('nav a[aria-current]')?.getAttribute('href')).toBe('/about');
  });

  it('shows the logo with the site name as its alternative text', async () => {
    const el = await render({ logo: { src: 'logo.png', width: 80, height: 40 } });

    expect(el.querySelector('img')?.getAttribute('alt')).toBe('Acme');
  });

  it('has no nav landmark without menu items', async () => {
    expect((await render({ navItems: [] })).querySelector('nav')).toBeNull();
  });

  it('is accessible', async () => {
    const el = await render();

    expect((await axe.run(el, { rules: { region: { enabled: false } } })).violations).toEqual([]);
  });
});
