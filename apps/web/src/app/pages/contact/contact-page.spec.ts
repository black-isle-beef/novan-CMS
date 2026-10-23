import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import axe from 'axe-core';
import { SITE_CONFIG, type SiteConfig } from '../../config/site-config';
import { ContactPage } from './contact-page';
import { ContactError, ContactService } from './contact.service';

const config: SiteConfig = {
  siteUrl: 'https://novan.example',
  cmsLoginUrl: '',
  contactForm: { entryId: 'entry-1', formUid: 'form-1' },
};

async function render(options: { enquiry?: string; send?: ContactService['send']; contactForm?: SiteConfig['contactForm'] } = {}) {
  const send = vi.fn(options.send ?? (async () => undefined));
  TestBed.configureTestingModule({
    imports: [ContactPage],
    providers: [
      provideRouter([]),
      { provide: SITE_CONFIG, useValue: { ...config, contactForm: options.contactForm === undefined ? config.contactForm : options.contactForm } },
      { provide: ContactService, useValue: { send } },
    ],
  });
  const fixture = TestBed.createComponent(ContactPage);
  if (options.enquiry) fixture.componentRef.setInput('enquiry', options.enquiry);
  fixture.detectChanges();
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const field = <T extends HTMLElement>(id: string) => host.querySelector<T>(`#contact-${id}`)!;
  const type = (id: string, value: string) => {
    const input = field<HTMLInputElement>(id);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const submit = async () => {
    host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const fillIn = () => {
    type('name', 'Sam Example');
    type('email', 'sam@example.com');
    type('message', 'Hello');
    field<HTMLInputElement>('consent').click();
  };
  return { fixture, host, field, type, submit, fillIn, send };
}

describe('ContactPage', () => {
  it('preselects the enquiry type from ?enquiry=, and ignores unknown ones', async () => {
    expect((await render({ enquiry: 'demo' })).field<HTMLSelectElement>('enquiry').value).toBe('demo');
    TestBed.resetTestingModule();
    expect((await render({ enquiry: 'nonsense' })).field<HTMLSelectElement>('enquiry').value).toBe('general');
  });

  it('lists every problem in a focused summary and on each field, without sending', async () => {
    const { host, field, submit, send } = await render();
    await submit();

    const summary = host.querySelector<HTMLElement>('.mk-error-summary')!;
    expect(document.activeElement).toBe(summary);
    expect(Array.from(summary.querySelectorAll('a')).map((link) => link.textContent?.trim())).toEqual([
      'Enter your name',
      'Enter your email address',
      'Enter your message',
      'Tick the box to agree to us contacting you about your enquiry',
    ]);
    const name = field('name');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(name.getAttribute('aria-describedby')).toBe('contact-name-error');
    expect(host.querySelector('#contact-name-error')?.textContent).toBe('Error: Enter your name');
    expect(send).not.toHaveBeenCalled();
  });

  it('explains a badly formed email address', async () => {
    const { host, type, submit } = await render();
    type('email', 'not-an-email');
    await submit();
    expect(host.querySelector('#contact-email-error')?.textContent).toContain('Enter an email address in the correct format');
    expect(host.querySelector('#contact-email')?.getAttribute('aria-describedby')).toBe('contact-email-hint contact-email-error');
  });

  it('sends the answers with the enquiry label and the honeypot, then announces success and clears the form', async () => {
    const { host, field, submit, fillIn, send } = await render({ enquiry: 'support' });
    fillIn();
    await submit();

    expect(send).toHaveBeenCalledWith(
      { entryId: 'entry-1', formUid: 'form-1' },
      { name: 'Sam Example', email: 'sam@example.com', enquiry: 'Support', message: 'Hello', consent: true },
      '',
    );
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Thank you. We have your enquiry');
    expect(field<HTMLInputElement>('name').value).toBe('');
    expect(field<HTMLSelectElement>('enquiry').value).toBe('support');
  });

  it("shows the API's own checks on the right fields", async () => {
    const { host, submit, fillIn } = await render({
      send: async () => {
        throw new ContactError(400, { email: ['Enter a valid email address.'] });
      },
    });
    fillIn();
    await submit();

    expect(host.querySelector('#contact-email-error')?.textContent).toBe('Error: Enter a valid email address.');
    expect(document.activeElement).toBe(host.querySelector('.mk-error-summary'));
  });

  it('announces a failure with the email address to use instead', async () => {
    const { host, submit, fillIn } = await render({
      send: async () => {
        throw new ContactError(503, {});
      },
    });
    fillIn();
    await submit();

    const status = host.querySelector('[role="status"]')!;
    expect(status.textContent).toContain('Sorry, your enquiry could not be sent');
    expect(status.querySelector('a')?.getAttribute('href')).toBe('mailto:hello@novan.example');
  });

  it('offers email instead when the site has no contact form set up', async () => {
    const { host } = await render({ contactForm: null });
    expect(host.querySelector('form')).toBeNull();
    expect(host.querySelector('.mk-contact__form a')?.getAttribute('href')).toBe('mailto:hello@novan.example');
  });

  it('has no axe violations, before and after a failed send', async () => {
    const { host, submit } = await render();
    expect((await axe.run(host, { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([]);
    await submit();
    expect((await axe.run(host, { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([]);
  });
});
