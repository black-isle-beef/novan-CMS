// components/form/form.component.spec.ts
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NOVAN_BLOCK_CONTEXT, NovanApiError, NovanForms, NovanLocale, NovanPreview } from '@black-isle-beef/cms-angular';

import { CmsStylePanelComponent } from '../../cms-style-panel/cms-style-panel.component';
import { kebab, renderBlock, settingsVariants } from '../../../testing/cms-testing';
import { FormBlock } from './form.component';
import { FORM_DEFINITION } from './form.definition';
import { FORM_SAMPLE_CONTENT, FORM_SCHEMA, type FormFields } from './form.schema';
import { TURNSTILE_LOADER, type TurnstileApi } from './turnstile';

const PAGE = '00000000-0000-4000-8000-000000000703';
const UID = '00000000-0000-4000-8000-000000000924';

interface Setup {
  siteKey?: string | null;
  preview?: boolean;
  context?: boolean;
}

function setup({ siteKey = null, preview = false, context = true }: Setup = {}) {
  const submit = vi.fn<NovanForms['submit']>().mockResolvedValue(undefined);
  const widget = { render: vi.fn<TurnstileApi['render']>(() => 'widget-1'), reset: vi.fn(), remove: vi.fn() };
  TestBed.configureTestingModule({
    imports: [FormBlock, CmsStylePanelComponent],
    providers: [
      provideRouter([]),
      { provide: NovanForms, useValue: { turnstileSiteKey: siteKey, submit } },
      { provide: NovanPreview, useValue: { active: signal(preview) } },
      { provide: NovanLocale, useValue: { current: signal('en-GB') } },
      { provide: TURNSTILE_LOADER, useValue: () => Promise.resolve(widget) },
      ...(context ? [{ provide: NOVAN_BLOCK_CONTEXT, useValue: { uid: UID, block: 'form', entryId: PAGE } }] : []),
    ],
  });
  return { submit, widget };
}

const render = (content: Partial<FormFields> = FORM_SAMPLE_CONTENT, settings?: unknown) => renderBlock(FormBlock, content, settings);

/** Fills in a field the way a visitor does. */
function fill(host: HTMLElement, label: string, value: string | boolean): void {
  const control = [...host.querySelectorAll<HTMLInputElement>('input, textarea, select')].find(
    (element) => host.querySelector(`label[for="${element.id}"]`)?.textContent?.includes(label),
  );
  if (!control) throw new Error(`No field labelled ${label}`);
  if (typeof value === 'boolean') {
    control.checked = value;
    control.dispatchEvent(new Event('change'));
  } else {
    control.value = value;
    control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input'));
  }
}

async function send(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }, host: HTMLElement): Promise<void> {
  host.querySelector('form')?.dispatchEvent(new Event('submit'));
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

function fillAll(host: HTMLElement): void {
  fill(host, 'Your name', '  Ada  ');
  fill(host, 'Email address', 'ada@example.com');
  fill(host, 'Size of dog', 'Medium');
  fill(host, 'I agree', true);
}

describe('FormBlock', () => {
  it('declares the block it renders', () => {
    expect(FormBlock.novanBlock).toEqual({ apiId: 'form', schemaVersion: 1 });
  });

  describe('content', () => {
    beforeEach(() => setup());

    it('renders a labelled control for each field, marking the required ones', () => {
      const { host } = render();

      expect(host.querySelector('h2')?.textContent).toBe('Book a grooming appointment');
      expect(host.querySelector('.novan-form-block__intro')?.textContent).toContain('Tell us about your dog');
      const name = host.querySelector<HTMLInputElement>('input[name="name"]');
      expect(name?.type).toBe('text');
      expect(name?.required).toBe(true);
      expect(name?.getAttribute('autocomplete')).toBe('name');
      expect(host.querySelector(`label[for="${name?.id}"]`)?.textContent).toContain('(required)');

      const email = host.querySelector<HTMLInputElement>('input[name="email"]');
      expect(email?.type).toBe('email');
      expect(email?.getAttribute('autocomplete')).toBe('email');
      expect(host.querySelector(`#${email?.getAttribute('aria-describedby')}`)?.textContent).toBe('We only use it to reply to you.');

      const options = [...host.querySelectorAll('select[name="size"] option')].map((option) => option.textContent);
      expect(options).toEqual(['Choose an option', 'Small', 'Medium', 'Large']);
      expect(host.querySelector('textarea[name="message"]')?.hasAttribute('required')).toBe(false);
      expect(host.querySelector<HTMLInputElement>('input[name="reminders"]')?.type).toBe('checkbox');
      expect(host.querySelector<HTMLInputElement>('input[name="consent"]')?.required).toBe(true);
      expect(host.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Send request');
    });

    it('names the section and the form by the heading', () => {
      const { host } = render();
      const id = host.querySelector('h2')?.id;
      expect(host.querySelector('section')?.getAttribute('aria-labelledby')).toBe(id);
      expect(host.querySelector('form')?.getAttribute('aria-labelledby')).toBe(id);
    });

    it('hides the honeypot from people and assistive technology', () => {
      const { host } = render();
      const trap = host.querySelector('.novan-form-block__trap');
      expect(trap?.getAttribute('aria-hidden')).toBe('true');
      expect(trap?.querySelector('input')?.getAttribute('tabindex')).toBe('-1');
    });

    it('leaves out fields stored data has broken, and what is missing', () => {
      const { host } = render({
        fields: [
          null as never,
          { label: 'No name', type: 'text' },
          { label: 'Bad type', name: 'x', type: 'file' as never },
          { label: 'No choices', name: 'y', type: 'select', options: '' },
          { label: 'First', name: 'dup', type: 'text' },
          { label: 'Second', name: 'dup', type: 'text' },
        ],
        submitLabel: '',
      });
      expect([...host.querySelectorAll('label')].map((label) => label.textContent?.trim()).filter((text) => text !== 'Leave this empty')).toEqual(['First']);
      expect(host.querySelector('h2')).toBeNull();
      expect(host.querySelector('section')?.hasAttribute('aria-labelledby')).toBe(false);
      expect(host.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Send');
    });

    it('updates in place when content changes (live preview)', () => {
      const { fixture, host } = render({ ...FORM_SAMPLE_CONTENT, heading: '' });
      fixture.componentRef.setInput('heading', 'Now a heading');
      fixture.componentRef.setInput('fields', [...(FORM_SAMPLE_CONTENT.fields ?? []), { label: 'Phone', name: 'phone', type: 'text' }]);
      fixture.detectChanges();
      expect(host.querySelector('section')?.getAttribute('aria-labelledby')).toBe(host.querySelector('h2')?.id);
      expect(host.querySelector<HTMLInputElement>('input[name="phone"]')?.getAttribute('autocomplete')).toBe('tel');

      fixture.componentRef.setInput('fields', [{ label: 'Only this', name: 'only', type: 'textarea' }]);
      fixture.detectChanges();
      expect(host.querySelectorAll('input:not([name="website"]), select, textarea')).toHaveLength(1);
    });
  });

  describe('settings', () => {
    beforeEach(() => setup());

    it('applies the schema defaults when no settings are stored', () => {
      expect(render().host.className.split(' ').sort()).toEqual(
        ['novan-form-block', 'novan-form-block--tone-light', 'novan-form-block--width-narrow', 'novan-form-block--heading-level-h2'].sort(),
      );
    });

    it.each(settingsVariants(FORM_SCHEMA).filter((variant) => variant.key !== null))('applies $name', ({ key, value, settings }) => {
      expect(render(FORM_SAMPLE_CONTENT, settings).host.classList).toContain(`novan-form-block--${kebab(key as string)}-${String(value)}`);
    });

    it.each(['h2', 'h3', 'h4'] as const)('renders the heading as %s', (headingLevel) => {
      const { host } = render(FORM_SAMPLE_CONTENT, { headingLevel });
      expect(host.querySelector(headingLevel)?.textContent).toBe('Book a grooming appointment');
      expect(host.querySelectorAll('h2, h3, h4')).toHaveLength(1);
    });

    it.each([
      ['unknown values', { tone: 'neon', width: 'huge' }],
      ['wrong types', { headingLevel: ['h3'] }],
      ['null', null],
    ])('falls back to defaults for %s', (_label, stored) => {
      const { host } = render(FORM_SAMPLE_CONTENT, stored);
      expect(host.classList).toContain('novan-form-block--tone-light');
      expect(host.classList).toContain('novan-form-block--width-narrow');
      expect(host.querySelector('h2')).not.toBeNull();
    });

    it('updates when settings change', () => {
      const { fixture, host } = render();
      fixture.componentRef.setInput('settings', { tone: 'dark', width: 'wide' });
      fixture.detectChanges();
      expect(host.classList).toContain('novan-form-block--tone-dark');
      expect(host.classList).toContain('novan-form-block--width-wide');
    });
  });

  describe('sending', () => {
    it('lists what needs fixing, linked to each field, and sends nothing', async () => {
      const { submit } = setup();
      const { fixture, host } = render();
      fill(host, 'Email address', 'not-an-email');
      await send(fixture, host);

      const summary = host.querySelector('.novan-form-block__summary [role="alert"]');
      expect([...(summary?.querySelectorAll('li a') ?? [])].map((a) => a.textContent)).toEqual([
        'Fill in this field.',
        'Enter an email address, like name@example.com.',
        'Tick this box to send the form.',
      ]);
      expect(document.activeElement).toBe(host.querySelector('.novan-form-block__summary'));
      const email = host.querySelector<HTMLInputElement>('input[name="email"]');
      expect(email?.getAttribute('aria-invalid')).toBe('true');
      expect(email?.getAttribute('aria-describedby')?.split(' ')).toHaveLength(2);
      expect(host.querySelector(`#${email?.id}-error`)?.textContent).toBe('Error: Enter an email address, like name@example.com.');

      (summary?.querySelectorAll('li a')[1] as HTMLAnchorElement).click();
      expect(document.activeElement).toBe(email);
      expect(submit).not.toHaveBeenCalled();

      fill(host, 'Email address', 'ada@example.com');
      fixture.detectChanges();
      expect(email?.hasAttribute('aria-invalid')).toBe(false);
    });

    it('sends the answers for its page and thanks the visitor', async () => {
      const { submit } = setup();
      const { fixture, host } = render();
      fillAll(host);
      await send(fixture, host);

      expect(submit).toHaveBeenCalledWith(UID, {
        entryId: PAGE,
        locale: 'en-GB',
        data: { name: 'Ada', email: 'ada@example.com', size: 'Medium', reminders: false, consent: true },
      });
      expect(host.querySelector('form')).toBeNull();
      const thanks = host.querySelector('.novan-form-block__success');
      expect(thanks?.getAttribute('role')).toBe('status');
      expect(thanks?.textContent).toContain('We have your request');
      expect(document.activeElement).toBe(thanks);
    });

    it('passes on what a robot put in the honeypot', async () => {
      const { submit } = setup();
      const { fixture, host } = render();
      fillAll(host);
      const trap = host.querySelector<HTMLInputElement>('input[name="website"]') as HTMLInputElement;
      trap.value = 'https://spam.example';
      trap.dispatchEvent(new Event('input'));
      await send(fixture, host);
      expect(submit.mock.calls[0][1].website).toBe('https://spam.example');
    });

    it('shows the API\'s messages on the fields it refused', async () => {
      const { submit } = setup();
      submit.mockRejectedValueOnce(new NovanApiError(400, 'form_invalid', 'Some answers need attention.', { email: ['That domain does not take email.'] }));
      const { fixture, host } = render();
      fillAll(host);
      await send(fixture, host);
      expect(host.querySelector('.novan-form-block__summary li')?.textContent).toBe('That domain does not take email.');
      expect(host.querySelector('form')).not.toBeNull();
    });

    it.each([
      [new NovanApiError(429, 'rate_limited', 'Too many forms have been sent from here.'), 'Too many forms have been sent from here.'],
      [new NovanApiError(502, 'api_unreachable', 'The content API could not be reached.'), 'Your message could not be sent. Please try again in a few minutes.'],
      [new Error('offline'), 'Your message could not be sent. Please try again in a few minutes.'],
    ])('explains a failure to send (%s)', async (error, message) => {
      const { submit } = setup();
      submit.mockRejectedValueOnce(error);
      const { fixture, host } = render();
      fillAll(host);
      await send(fixture, host);
      expect(host.querySelector('.novan-form-block__summary [role="alert"]')?.textContent?.trim()).toBe(message);
    });

    it('does not send in the visual editor, and says so', async () => {
      const { submit } = setup({ preview: true });
      const { fixture, host } = render();
      expect(host.querySelector('[role="note"]')?.textContent).toContain('does not send while you are previewing');
      fillAll(host);
      await send(fixture, host);
      expect(submit).not.toHaveBeenCalled();
      expect(host.querySelector('.novan-form-block__summary')?.textContent).toContain('does not send while you are previewing');
    });

    it('cannot send without knowing its page', async () => {
      const { submit } = setup({ context: false });
      const { fixture, host } = render();
      fillAll(host);
      await send(fixture, host);
      expect(submit).not.toHaveBeenCalled();
      expect(host.querySelector('.novan-form-block__summary')?.textContent).toContain('cannot be sent from here');
    });
  });

  describe('Cloudflare Turnstile', () => {
    it('shows the widget when the site has a site key, and sends its answer', async () => {
      const { submit, widget } = setup({ siteKey: '1x00000000000000000000AA' });
      const { fixture, host } = render();
      await fixture.whenStable();
      expect(widget.render).toHaveBeenCalledWith(
        host.querySelector('.novan-form-block__check'),
        expect.objectContaining({ sitekey: '1x00000000000000000000AA', language: 'en-GB' }),
      );

      fillAll(host);
      await send(fixture, host);
      expect(submit).not.toHaveBeenCalled();
      expect(host.querySelector('.novan-form-block__summary')?.textContent).toContain('not a robot');

      widget.render.mock.calls[0][1].callback('token-1');
      await send(fixture, host);
      expect(submit.mock.calls[0][1].turnstileToken).toBe('token-1');
      expect(widget.remove).toHaveBeenCalledWith('widget-1');
    });

    it('asks again after a refused check', async () => {
      const { submit, widget } = setup({ siteKey: 'key' });
      submit.mockRejectedValueOnce(new NovanApiError(400, 'spam_check_failed', 'Complete the check that you are not a robot, then send the form again.'));
      const { fixture, host } = render();
      await fixture.whenStable();
      widget.render.mock.calls[0][1].callback('used-token');
      fillAll(host);
      await send(fixture, host);
      expect(widget.reset).toHaveBeenCalledWith('widget-1');
      expect(host.querySelector('.novan-form-block__summary')?.textContent).toContain('Complete the check');
    });

    it('shows no widget without a site key', () => {
      const { widget } = setup();
      render();
      expect(widget.render).not.toHaveBeenCalled();
    });
  });

  describe('editor panel', () => {
    it('offers a control for every style option and updates the preview', () => {
      setup();
      const fixture = TestBed.createComponent(CmsStylePanelComponent);
      fixture.componentRef.setInput('definition', FORM_DEFINITION);
      fixture.detectChanges();
      const element = fixture.nativeElement as HTMLElement;

      const labels = Array.from(element.querySelectorAll('label, legend')).map((node) => node.textContent?.trim());
      for (const field of Object.values(FORM_SCHEMA)) expect(labels).toContain(field.label);

      const select = element.querySelector<HTMLSelectElement>('.novan-style-panel select');
      if (select) {
        select.value = 'h3';
        select.dispatchEvent(new Event('change'));
      }
      fixture.detectChanges();
      expect(element.querySelector('novan-form-block h3')).not.toBeNull();
      expect(fixture.componentInstance.settings()).toEqual({ tone: 'light', width: 'narrow', headingLevel: 'h3' });
    });
  });
});
