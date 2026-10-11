// components/form/form.a11y.spec.ts
// axe-core in jsdom; colour contrast is covered in a real browser by the starter site's Playwright tests
// (apps/starter-site-e2e/src/forms.spec.ts renders the form in every tone, with errors showing).
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NOVAN_BLOCK_CONTEXT, NovanForms, NovanLocale, NovanPreview } from '@black-isle-beef/cms-angular';

import { CmsStylePanelComponent } from '../../cms-style-panel/cms-style-panel.component';
import { expectNoAxeViolations, renderBlock, settingsVariants } from '../../../testing/cms-testing';
import { FormBlock } from './form.component';
import { FORM_DEFINITION } from './form.definition';
import { FORM_SAMPLE_CONTENT, FORM_SCHEMA, type FormFields } from './form.schema';
import { TURNSTILE_LOADER } from './turnstile';

const render = (content: Partial<FormFields> = FORM_SAMPLE_CONTENT, settings?: unknown) => renderBlock(FormBlock, content, settings);

describe('FormBlock accessibility', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [FormBlock, CmsStylePanelComponent],
      providers: [
        provideRouter([]),
        { provide: NovanForms, useValue: { turnstileSiteKey: null, submit: () => Promise.resolve() } },
        { provide: NovanPreview, useValue: { active: signal(false) } },
        { provide: NovanLocale, useValue: { current: signal('en-GB') } },
        { provide: TURNSTILE_LOADER, useValue: () => new Promise(() => undefined) },
        { provide: NOVAN_BLOCK_CONTEXT, useValue: { uid: 'u', block: 'form', entryId: 'p' } },
      ],
    });
  });

  it('has no violations with default settings', async () => {
    await expectNoAxeViolations(render().host);
  });

  it.each(settingsVariants(FORM_SCHEMA))('has no violations with $name', async ({ settings }) => {
    await expectNoAxeViolations(render(FORM_SAMPLE_CONTENT, settings).host);
  });

  it('has no violations with every problem showing', async () => {
    const { fixture, host } = render();
    host.querySelector('form')?.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(host.querySelectorAll('[aria-invalid="true"]').length).toBeGreaterThan(0);
    await expectNoAxeViolations(host);
  });

  it('has no violations once sent', async () => {
    const { fixture, host } = render();
    const fill = (name: string, value: string) => {
      const input = host.querySelector<HTMLInputElement>(`[name="${name}"]`) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    fill('name', 'Ada');
    fill('email', 'ada@example.com');
    const consent = host.querySelector<HTMLInputElement>('[name="consent"]') as HTMLInputElement;
    consent.checked = true;
    consent.dispatchEvent(new Event('change'));
    host.querySelector('form')?.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(host.querySelector('.novan-form-block__success')).not.toBeNull();
    await expectNoAxeViolations(host);
  });

  it('has no violations with minimal and long content', async () => {
    const long = 'Tell us about your dog, their coat and anything that worries them about grooming. '.repeat(3);
    await expectNoAxeViolations(render({ fields: [{ label: 'Message', name: 'message', type: 'textarea' }] }).host);
    await expectNoAxeViolations(
      render({
        heading: long.slice(0, 120),
        intro: long.slice(0, 300),
        fields: [{ label: long.slice(0, 200), name: 'long', type: 'text', required: true, help: long.slice(0, 200) }],
        submitLabel: long.slice(0, 60),
      }).host,
    );
  });

  it('has no violations in the editor panel', async () => {
    const fixture = TestBed.createComponent(CmsStylePanelComponent);
    fixture.componentRef.setInput('definition', FORM_DEFINITION);
    fixture.detectChanges();
    await expectNoAxeViolations(fixture.nativeElement);
  });
});
