import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  effect,
  type ElementRef,
  inject,
  Injector,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, type ValidationErrors, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { contactForm, type EnquiryType, site } from '@novan/marketing-content';
import { MkHero } from '@novan/marketing-ui';
import { SITE_CONFIG } from '../../config/site-config';
import { ContactError, ContactService } from './contact.service';

export type ContactField = 'name' | 'email' | 'company' | 'enquiry' | 'message' | 'consent';

/** Error messages, written as instructions (GOV.UK style). */
const messages: Record<ContactField, Partial<Record<string, string>>> = {
  name: { required: 'Enter your name', maxlength: `Name must be ${contactForm.limits.name} characters or fewer` },
  email: {
    required: 'Enter your email address',
    email: 'Enter an email address in the correct format, like name@example.com',
    maxlength: `Email address must be ${contactForm.limits.email} characters or fewer`,
  },
  company: { maxlength: `Company must be ${contactForm.limits.company} characters or fewer` },
  enquiry: { required: 'Choose what your enquiry is about' },
  message: { required: 'Enter your message', maxlength: `Message must be ${contactForm.limits.message} characters or fewer` },
  consent: { required: 'Tick the box to agree to us contacting you about your enquiry' },
};

const FIELDS: readonly ContactField[] = ['name', 'email', 'company', 'enquiry', 'message', 'consent'];

/**
 * `/contact`: the enquiry form and how else to reach us. Enquiries go to the Forms feature (`ContactService`); errors
 * are listed in a summary that takes focus, and shown beside each field; the outcome is announced in a status region.
 * `?enquiry=demo` (and sales, support, general) preselects the enquiry type.
 */
@Component({
  selector: 'app-contact-page',
  imports: [MkHero, ReactiveFormsModule, RouterLink],
  templateUrl: './contact-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactPage {
  /** From `?enquiry=`. */
  readonly enquiry = input<string>();

  private readonly contact = inject(ContactService);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);

  protected readonly config = inject(SITE_CONFIG);
  protected readonly site = site;
  protected readonly text = contactForm;
  protected readonly ids: Record<ContactField, string> = {
    name: 'contact-name',
    email: 'contact-email',
    company: 'contact-company',
    enquiry: 'contact-enquiry',
    message: 'contact-message',
    consent: 'contact-consent',
  };

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.maxLength(contactForm.limits.name)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(contactForm.limits.email)]],
    company: ['', [Validators.maxLength(contactForm.limits.company)]],
    enquiry: ['general' as EnquiryType, [Validators.required]],
    message: ['', [Validators.required, Validators.maxLength(contactForm.limits.message)]],
    consent: [false, [Validators.requiredTrue]],
    /** The honeypot: hidden from people, so anything in it marks a robot. */
    website: [''],
  });

  protected readonly state = signal<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  /** Errors show once the visitor has tried to send. */
  protected readonly showErrors = signal(false);
  protected readonly summary = signal<readonly { field: ContactField; message: string }[]>([]);
  private readonly summaryBox = viewChild<ElementRef<HTMLElement>>('summaryBox');

  constructor() {
    effect(() => {
      const enquiry = this.enquiry();
      const control = this.form.controls.enquiry;
      if (enquiry && isEnquiry(enquiry) && control.pristine) control.setValue(enquiry);
    });
  }

  /** The message to show for a field, or null. */
  protected error(field: ContactField): string | null {
    if (!this.showErrors()) return null;
    const errors = this.form.controls[field].errors;
    return errors ? messageFor(field, errors) : null;
  }

  protected describedBy(field: ContactField, hint = false): string | null {
    const ids = [hint ? `${this.ids[field]}-hint` : null, this.error(field) ? `${this.ids[field]}-error` : null].filter(Boolean);
    return ids.length ? ids.join(' ') : null;
  }

  protected async submit(): Promise<void> {
    if (this.state() === 'sending') return;
    this.showErrors.set(true);
    if (this.form.invalid) {
      this.showSummary();
      return;
    }
    const target = this.config.contactForm;
    if (!target) return;

    this.summary.set([]);
    this.state.set('sending');
    const value = this.form.getRawValue();
    const enquiry = contactForm.enquiryTypes.find((type) => type.value === value.enquiry)?.label ?? value.enquiry;
    const data: Record<string, string | boolean> = {
      [contactForm.fields.name]: value.name.trim(),
      [contactForm.fields.email]: value.email.trim(),
      [contactForm.fields.enquiry]: enquiry,
      [contactForm.fields.message]: value.message.trim(),
      [contactForm.fields.consent]: value.consent,
    };
    if (value.company.trim()) data[contactForm.fields.company] = value.company.trim();

    try {
      await this.contact.send(target, data, value.website);
      this.state.set('sent');
      this.showErrors.set(false);
      this.form.reset({ enquiry: value.enquiry });
    } catch (error) {
      if (error instanceof ContactError && this.applyServerErrors(error)) {
        this.state.set('idle');
        this.showSummary();
      } else {
        this.state.set('failed');
      }
    }
  }

  /** Moves focus to a field from the error summary. */
  protected focusField(event: Event, field: ContactField): void {
    event.preventDefault();
    this.document.getElementById(this.ids[field])?.focus();
  }

  private showSummary(): void {
    this.summary.set(
      FIELDS.flatMap((field) => {
        const message = this.error(field);
        return message ? [{ field, message }] : [];
      }),
    );
    afterNextRender(() => this.summaryBox()?.nativeElement.focus(), { injector: this.injector });
  }

  /** The API's own checks, shown on the fields they belong to. False when none of them are about a field. */
  private applyServerErrors(error: ContactError): boolean {
    let applied = false;
    for (const field of FIELDS) {
      const message = error.fieldErrors[contactForm.fields[field]]?.[0];
      if (!message) continue;
      this.form.controls[field].setErrors({ server: message });
      applied = true;
    }
    return applied;
  }
}

function messageFor(field: ContactField, errors: ValidationErrors): string {
  if (typeof errors['server'] === 'string') return errors['server'];
  const key = Object.keys(errors)[0] ?? 'required';
  return messages[field][key] ?? messages[field]['required'] ?? 'Check this answer';
}

function isEnquiry(value: string): value is EnquiryType {
  return contactForm.enquiryTypes.some((type) => type.value === value);
}
