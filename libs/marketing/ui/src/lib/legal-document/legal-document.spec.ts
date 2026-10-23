import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { cookiePolicy, privacyPolicy } from '@novan/marketing-content';
import axe from 'axe-core';
import { ConsentService } from '../consent/consent.service';
import { MkLegalDocument } from './legal-document';

function render(document = cookiePolicy) {
  TestBed.configureTestingModule({ imports: [MkLegalDocument], providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(MkLegalDocument);
  fixture.componentRef.setInput('document', document);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('MkLegalDocument', () => {
  it('shows the title, the date it last changed and a contents list linking to every section', () => {
    const host = render();

    expect(host.querySelector('h1')?.textContent?.trim()).toBe('Cookie policy');
    expect(host.querySelector('time')?.getAttribute('datetime')).toBe(cookiePolicy.lastUpdated);
    expect(host.querySelector('time')?.textContent?.trim()).toBe('23 October 2026');
    const links = Array.from(host.querySelectorAll<HTMLAnchorElement>('.mk-legal__toc a'));
    expect(links.map((link) => link.getAttribute('href'))).toEqual(cookiePolicy.sections.map((section) => `/#${section.id}`));
    for (const section of cookiePolicy.sections) expect(host.querySelector(`section#${section.id} h2`)?.textContent?.trim()).toBe(section.heading);
  });

  it('lists the cookie register in a table, and "Cookie settings" reopens the banner', () => {
    const host = render();
    const table = host.querySelector('table')!;

    expect(table.querySelector('caption')?.textContent?.trim()).toBe('Cookies and storage this website uses');
    expect(table.querySelector('tbody th[scope="row"]')?.textContent?.trim()).toBe('novan_consent');
    host.querySelector<HTMLButtonElement>('.mk-legal__section button')!.click();
    expect(TestBed.inject(ConsentService).bannerOpen()).toBe(true);
  });

  it('renders links in the text: site paths in the app, others as plain links', () => {
    const host = render(privacyPolicy);
    const ico = Array.from(host.querySelectorAll('a')).find((link) => link.textContent?.includes('ico.org.uk'));
    const cookies = Array.from(host.querySelectorAll('a')).find((link) => link.textContent === 'cookie policy');

    expect(ico?.getAttribute('href')).toBe('https://ico.org.uk/make-a-complaint/');
    expect(cookies?.getAttribute('href')).toBe('/cookies');
  });

  it('has no axe violations', async () => {
    const host = render();
    const results = await axe.run(host, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
