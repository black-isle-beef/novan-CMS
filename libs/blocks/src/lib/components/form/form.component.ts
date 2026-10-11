// components/form/form.component.ts — styles: src/styles/_form.scss.
import { isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  PLATFORM_ID,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  NOVAN_BLOCK_CONTEXT,
  type NovanBlock,
  NovanApiError,
  NovanForms,
  NovanLocale,
  NovanPreview,
} from '@black-isle-beef/cms-angular';

import { blockId, blockText } from '../../block-text';
import { type CmsStoredSettings, modifierClasses, resolveSettings } from '../../cms-schema';
import { FORM_FIELD_TYPES, FORM_SCHEMA, type FormFieldItem, type FormFields, type FormFieldType, type FormSettings } from './form.schema';
import { TURNSTILE_LOADER, type TurnstileApi } from './turnstile';

/** One field, checked and ready to render. */
interface FieldView {
  name: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  help: string | null;
  options: string[];
  id: string;
  hintId: string;
  errorId: string;
  autocomplete: string | null;
}

/** The longest answer each type takes, as the API checks. */
const MAX_LENGTH: Readonly<Record<'text' | 'email' | 'textarea', number>> = { text: 500, email: 254, textarea: 5000 };
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Browsers fill these in for people, from the answer's name. */
const AUTOCOMPLETE: Readonly<Record<string, string>> = {
  name: 'name',
  'full-name': 'name',
  email: 'email',
  phone: 'tel',
  telephone: 'tel',
  company: 'organization',
  organisation: 'organization',
  postcode: 'postal-code',
};

type State = 'idle' | 'sending' | 'sent';

/**
 * A form editors build from fields (text, email, long text, a choice from a list, a tick box and consent) and visitors
 * send to the Forms inbox (docs/build/18-search-forms-audit.md). Answers are checked here for quick help and again by
 * the API, which decides; a hidden honeypot field and Cloudflare Turnstile (when the site has a site key) keep robots
 * out. Problems are listed in a summary that takes focus, each linked to its field; each field also shows its own
 * message. Once sent, the thank-you message replaces the form and takes focus. In the visual editor the form shows but
 * does not send.
 */
@Component({
  selector: 'novan-form-block',
  templateUrl: './form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'hostClasses()' },
})
export class FormBlock implements NovanBlock<FormFields> {
  static readonly novanBlock = { apiId: 'form', schemaVersion: 1 };

  readonly heading = input<string>();
  readonly intro = input<string>();
  readonly fields = input<FormFieldItem[] | null>();
  readonly submitLabel = input<string>();
  readonly successMessage = input<string>();
  /** Raw style options. Missing or invalid values fall back to the schema defaults. */
  readonly settings = input<Partial<FormSettings> | CmsStoredSettings | null | undefined>(undefined);

  private readonly forms = inject(NovanForms);
  private readonly locale = inject(NovanLocale);
  private readonly context = inject(NOVAN_BLOCK_CONTEXT, { optional: true });
  private readonly loadTurnstile = inject(TURNSTILE_LOADER);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  protected readonly preview = inject(NovanPreview);

  private readonly ids = blockId('novan-form-block', 'form');
  protected readonly headingId = `${this.ids}-heading`;
  protected readonly summaryId = `${this.ids}-summary`;
  protected readonly honeypotId = `${this.ids}-website`;
  protected readonly resolved = computed(() => resolveSettings(FORM_SCHEMA, this.settings()));
  protected readonly headingText = computed(() => blockText(this.heading()));
  protected readonly introText = computed(() => blockText(this.intro()));
  protected readonly buttonText = computed(() => blockText(this.submitLabel()) ?? 'Send');
  protected readonly thanks = computed(() => blockText(this.successMessage()) ?? 'Thank you. Your message has been sent.');
  protected readonly items = computed(() => fieldViews(this.fields(), this.ids));
  protected readonly siteKey = this.forms.turnstileSiteKey;
  protected readonly hostClasses = computed(() =>
    ['novan-form-block', ...modifierClasses('novan-form-block', FORM_SCHEMA, this.resolved())].join(' '),
  );

  protected readonly values = signal<Readonly<Record<string, string | boolean>>>({});
  protected readonly errors = signal<Readonly<Record<string, string>>>({});
  /** The problems, in the order of the fields, for the summary. */
  protected readonly problems = computed(() => {
    const errors = this.errors();
    return this.items().flatMap((field) => (errors[field.name] ? [{ id: field.id, message: errors[field.name] }] : []));
  });
  /** A problem with the whole form, such as the API being unreachable. */
  protected readonly failure = signal<string | null>(null);
  protected readonly state = signal<State>('idle');
  private readonly honeypot = signal('');
  private readonly token = signal<string | null>(null);
  private widget: { api: TurnstileApi; id: string } | null = null;

  private readonly summary = viewChild<ElementRef<HTMLElement>>('summary');
  private readonly success = viewChild<ElementRef<HTMLElement>>('success');
  private readonly check = viewChild<ElementRef<HTMLElement>>('check');

  constructor() {
    // The Turnstile widget, once its box is on the page in a browser; it goes when the form is sent or removed.
    effect(() => {
      const element = this.check()?.nativeElement;
      const siteKey = this.siteKey;
      untracked(() => {
        if (element && siteKey && this.browser && !this.widget) void this.renderCheck(element, siteKey);
      });
    });
    inject(DestroyRef).onDestroy(() => this.removeCheck());
  }

  protected answer(field: FieldView): string | boolean | undefined {
    return this.values()[field.name];
  }

  protected typed(field: FieldView, value: string): void {
    this.values.update((values) => ({ ...values, [field.name]: value }));
    if (this.errors()[field.name]) this.revalidate(field);
  }

  protected ticked(field: FieldView, checked: boolean): void {
    this.values.update((values) => ({ ...values, [field.name]: checked }));
    if (this.errors()[field.name]) this.revalidate(field);
  }

  protected trapped(value: string): void {
    this.honeypot.set(value);
  }

  protected describedBy(field: FieldView): string | null {
    const ids = [field.help ? field.hintId : null, this.errors()[field.name] ? field.errorId : null].filter(Boolean);
    return ids.length ? ids.join(' ') : null;
  }

  /** Takes a link in the summary to its field. */
  protected goTo(event: Event, id: string): void {
    event.preventDefault();
    this.host.nativeElement.querySelector<HTMLElement>(`[id="${id}"]`)?.focus();
  }

  protected async send(event: Event): Promise<void> {
    event.preventDefault();
    if (this.state() === 'sending') return;
    this.failure.set(null);

    const errors: Record<string, string> = {};
    for (const field of this.items()) {
      const message = problemWith(field, this.values()[field.name]);
      if (message) errors[field.name] = message;
    }
    this.errors.set(errors);
    if (Object.keys(errors).length) {
      this.focus(this.summary);
      return;
    }
    if (this.preview.active()) {
      this.failure.set('This form is shown as visitors see it. It does not send while you are previewing.');
      return;
    }
    const entryId = this.context?.entryId;
    if (!this.context || !entryId) {
      this.failure.set('This form cannot be sent from here. Please contact us another way.');
      return;
    }
    if (this.siteKey && !this.token()) {
      this.failure.set('Please wait a moment while we check that you are not a robot, then send the form again.');
      return;
    }

    this.state.set('sending');
    try {
      await this.forms.submit(this.context.uid, {
        entryId,
        locale: this.locale.current() ?? undefined,
        data: this.answers(),
        ...(this.token() ? { turnstileToken: this.token() as string } : {}),
        ...(this.honeypot() ? { website: this.honeypot() } : {}),
      });
      this.state.set('sent');
      this.removeCheck();
      this.focus(this.success);
    } catch (error) {
      this.state.set('idle');
      this.refused(error);
    }
  }

  /** The answers to send: text trimmed and left out when empty, tick boxes as true or false. */
  private answers(): Record<string, string | boolean> {
    const values = this.values();
    const answers: Record<string, string | boolean> = {};
    for (const field of this.items()) {
      const value = values[field.name];
      if (field.type === 'checkbox' || field.type === 'consent') answers[field.name] = value === true;
      else if (typeof value === 'string' && value.trim()) answers[field.name] = value.trim();
    }
    return answers;
  }

  private refused(error: unknown): void {
    this.resetCheck();
    if (error instanceof NovanApiError && error.code === 'form_invalid') {
      const names = new Set(this.items().map((field) => field.name));
      const errors: Record<string, string> = {};
      for (const [name, messages] of Object.entries(error.errors)) if (names.has(name) && messages[0]) errors[name] = messages[0];
      if (Object.keys(errors).length) {
        this.errors.set(errors);
        this.focus(this.summary);
        return;
      }
    }
    const message =
      error instanceof NovanApiError && ['spam_check_failed', 'rate_limited', 'form_not_found'].includes(error.code ?? '')
        ? error.message
        : 'Your message could not be sent. Please try again in a few minutes.';
    this.failure.set(message);
    this.focus(this.summary);
  }

  private revalidate(field: FieldView): void {
    const message = problemWith(field, this.values()[field.name]);
    this.errors.update((errors) => {
      const next = { ...errors };
      if (message) next[field.name] = message;
      else delete next[field.name];
      return next;
    });
  }

  private focus(target: () => ElementRef<HTMLElement> | undefined): void {
    afterNextRender(() => target()?.nativeElement.focus(), { injector: this.injector });
  }

  private async renderCheck(element: HTMLElement, siteKey: string): Promise<void> {
    try {
      const api = await this.loadTurnstile();
      if (this.widget || this.state() === 'sent') return;
      const id = api.render(element, {
        sitekey: siteKey,
        action: 'form',
        language: this.locale.current() ?? undefined,
        callback: (token) => this.token.set(token),
        'expired-callback': () => this.token.set(null),
        'error-callback': () => this.token.set(null),
      });
      this.widget = { api, id };
    } catch {
      this.failure.set('The check that you are not a robot could not load. Please reload the page to send this form.');
    }
  }

  private resetCheck(): void {
    this.token.set(null);
    if (this.widget) this.widget.api.reset(this.widget.id);
  }

  private removeCheck(): void {
    if (this.widget) this.widget.api.remove(this.widget.id);
    this.widget = null;
  }
}

/** What is wrong with an answer, in the API's words, or null. */
function problemWith(field: FieldView, value: string | boolean | undefined): string | null {
  if (field.type === 'checkbox') return null;
  if (field.type === 'consent') return field.required && value !== true ? 'Tick this box to send the form.' : null;
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return field.required ? (field.type === 'select' ? 'Choose one of the options.' : 'Fill in this field.') : null;
  if (field.type === 'email' && !EMAIL_PATTERN.test(text)) return 'Enter an email address, like name@example.com.';
  if (field.type === 'select') return field.options.includes(text) ? null : 'Choose one of the options.';
  const max = MAX_LENGTH[field.type];
  return text.length > max ? `Use ${max} characters or fewer.` : null;
}

/** The fields to show: stored data, so broken or repeated ones are left out, as the API does. */
function fieldViews(fields: unknown, prefix: string): FieldView[] {
  if (!Array.isArray(fields)) return [];
  const seen = new Set<string>();
  const views: FieldView[] = [];
  for (const raw of fields) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const name = blockText(item['name']);
    const label = blockText(item['label']);
    const type = item['type'];
    if (!name || !NAME_PATTERN.test(name) || seen.has(name) || name === 'website' || !label) continue;
    if (!(FORM_FIELD_TYPES as readonly unknown[]).includes(type)) continue;
    const options =
      type === 'select' && typeof item['options'] === 'string'
        ? [...new Set(item['options'].split(/\r?\n/).map((line) => line.trim()).filter(Boolean))]
        : [];
    if (type === 'select' && !options.length) continue;
    seen.add(name);
    const id = `${prefix}-${name}`;
    views.push({
      name,
      label,
      type: type as FormFieldType,
      required: item['required'] === true,
      help: blockText(item['help']),
      options,
      id,
      hintId: `${id}-hint`,
      errorId: `${id}-error`,
      autocomplete: type === 'email' ? 'email' : (AUTOCOMPLETE[name] ?? null),
    });
  }
  return views;
}
