import { DatePipe } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DOCUMENT,
  effect,
  type ElementRef,
  inject,
  Injector,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { type AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, type ValidationErrors, Validators } from '@angular/forms';
import { DsAlertComponent, DsSpinnerComponent } from '@black-isle-beef/novan-design-system';
import { Confirm, saveDownload } from '@novan/admin-shell';
import { problemMessage, SpaceContext } from '@novan/admin-spaces';
import type { FormSettings, FormSubmission, FormSummary } from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { FormsApi } from '../forms-api';

const PAGE_SIZE = 50;
/** One address per line, or separated by commas. */
const splitAddresses = (text: string): string[] =>
  text
    .split(/[\s,;]+/)
    .map((address) => address.trim())
    .filter(Boolean);
const addressPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Up to ten email addresses (or none). */
function addresses(control: AbstractControl<string>): ValidationErrors | null {
  const list = splitAddresses(control.value);
  return list.length <= 10 && list.every((address) => addressPattern.test(address)) ? null : { addresses: true };
}

/**
 * The Forms inbox (docs/build/18-search-forms-audit.md): what visitors sent through the space's forms, newest first,
 * by form or all together. A message opens beside the list; editors and admins can download a form's messages as a
 * spreadsheet (CSV) and delete a message. Admins choose who is emailed about new messages and how long messages are
 * kept; editors see those settings. `?submission=<id>` opens one message (the link in the email).
 */
@Component({
  selector: 'nv-forms-page',
  imports: [DatePipe, DsAlertComponent, DsSpinnerComponent, ReactiveFormsModule],
  templateUrl: './forms-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormsPage {
  private readonly api = inject(FormsApi);
  private readonly confirm = inject(Confirm);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  protected readonly context = inject(SpaceContext);

  /** Bound from the `:spaceId` route parameter. */
  readonly spaceId = input.required<string>();
  /** `?submission=`: a message to open. */
  readonly submission = input<string | undefined>(undefined);

  protected readonly forms = signal<FormSummary[] | null>(null);
  protected readonly items = signal<FormSubmission[] | null>(null);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly filter = signal<string>('');
  protected readonly open = signal<FormSubmission | null>(null);
  protected readonly settings = signal<FormSettings | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly status = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);

  protected readonly canChangeSettings = computed(() => this.context.can('forms.settings') && this.context.viewingAs() === null);
  protected readonly total = computed(() => (this.forms() ?? []).reduce((sum, form) => sum + form.count, 0));
  protected readonly chosenForm = computed(() => (this.forms() ?? []).find((form) => form.formUid === this.filter()) ?? null);

  private readonly detailHeading = viewChild<ElementRef<HTMLElement>>('detailHeading');

  protected readonly settingsForm = inject(NonNullableFormBuilder).group({
    recipients: ['', [addresses]],
    retentionMonths: [12, [Validators.required, Validators.min(1), Validators.max(120)]],
  });

  constructor() {
    effect(() => {
      const spaceId = this.spaceId();
      untracked(() => {
        this.context.currentSpaceId.set(spaceId);
        void this.load(spaceId);
      });
    });
    effect(() => {
      const id = this.submission();
      if (id) untracked(() => void this.show(id, true));
    });
  }

  protected formName(form: { formName: string | null; pagePath: string | null }): string {
    return form.formName ?? (form.pagePath ? `Form on ${form.pagePath}` : 'Untitled form');
  }

  /** A short line saying who a message is from: its first answer. */
  protected summary(submission: FormSubmission): string {
    const first = submission.fields.find((field) => typeof submission.data[field.name] === 'string');
    const text = first ? String(submission.data[first.name]) : '';
    return text.length > 60 ? `${text.slice(0, 59)}…` : text;
  }

  protected answer(value: string | boolean | undefined): string {
    if (value === true) return 'Yes';
    if (value === false) return 'No';
    return value ?? '—';
  }

  protected async choose(event: Event): Promise<void> {
    this.filter.set((event.target as HTMLSelectElement).value);
    this.clearMessages();
    await this.loadItems(this.spaceId());
  }

  protected async more(): Promise<void> {
    const cursor = this.nextCursor();
    if (!cursor) return;
    await this.act(async () => {
      const page = await firstValueFrom(this.api.submissions(this.spaceId(), { form: this.filter() || undefined, cursor, limit: PAGE_SIZE }));
      this.items.update((list) => [...(list ?? []), ...page.items]);
      this.nextCursor.set(page.nextCursor);
      this.status.set(`Showing ${this.items()?.length} messages.`);
    });
  }

  protected async show(id: string, fetch = false): Promise<void> {
    const known = this.items()?.find((item) => item.id === id);
    try {
      this.open.set(known && !fetch ? known : await firstValueFrom(this.api.submission(this.spaceId(), id)));
    } catch (error) {
      this.actionError.set(problemMessage(error));
      return;
    }
    afterNextRender(() => this.detailHeading()?.nativeElement.focus(), { injector: this.injector });
  }

  protected async remove(submission: FormSubmission): Promise<void> {
    this.clearMessages();
    const confirmed = await this.confirm.ask({
      heading: 'Delete this message?',
      body: 'It is deleted for good, and is no longer in downloads. You cannot undo this.',
      confirmLabel: 'Delete message',
      destructive: true,
    });
    if (!confirmed) return;
    await this.act(async () => {
      await firstValueFrom(this.api.deleteSubmission(this.spaceId(), submission.id));
      this.items.update((list) => (list ?? []).filter((item) => item.id !== submission.id));
      this.forms.update((list) =>
        (list ?? []).map((form) => (form.formUid === submission.formUid ? { ...form, count: form.count - 1 } : form)).filter((form) => form.count > 0),
      );
      if (this.open()?.id === submission.id) this.open.set(null);
      this.status.set('The message is deleted.');
    });
  }

  protected async download(): Promise<void> {
    const form = this.chosenForm();
    if (!form) return;
    this.clearMessages();
    await this.act(async () => {
      saveDownload(this.document, await firstValueFrom(this.api.export(this.spaceId(), form.formUid)));
      this.status.set(`The messages of ${this.formName(form)} are downloading as a spreadsheet (CSV).`);
    });
  }

  protected invalid(control: 'recipients' | 'retentionMonths'): boolean {
    return this.submitted() && this.settingsForm.controls[control].invalid;
  }

  protected async saveSettings(): Promise<void> {
    this.submitted.set(true);
    this.clearMessages();
    if (this.settingsForm.invalid) return;
    const { recipients, retentionMonths } = this.settingsForm.getRawValue();
    await this.act(async () => {
      const saved = await firstValueFrom(
        this.api.updateSettings(this.spaceId(), { recipients: splitAddresses(recipients), retentionMonths: Number(retentionMonths) }),
      );
      this.applySettings(saved);
      this.submitted.set(false);
      this.status.set('Form settings saved.');
    });
  }

  private applySettings(settings: FormSettings): void {
    this.settings.set(settings);
    this.settingsForm.reset({ recipients: settings.recipients.join('\n'), retentionMonths: settings.retentionMonths });
  }

  private async load(spaceId: string): Promise<void> {
    this.forms.set(null);
    this.items.set(null);
    this.open.set(null);
    this.loadError.set(null);
    this.clearMessages();
    try {
      const [forms, settings] = await Promise.all([firstValueFrom(this.api.forms(spaceId)), firstValueFrom(this.api.settings(spaceId))]);
      this.forms.set(forms);
      this.applySettings(settings);
      if (this.filter() && !forms.some((form) => form.formUid === this.filter())) this.filter.set('');
      await this.loadItems(spaceId);
    } catch (error) {
      this.loadError.set(problemMessage(error));
    }
  }

  private async loadItems(spaceId: string): Promise<void> {
    this.items.set(null);
    try {
      const page = await firstValueFrom(this.api.submissions(spaceId, { form: this.filter() || undefined, limit: PAGE_SIZE }));
      this.items.set(page.items);
      this.nextCursor.set(page.nextCursor);
    } catch (error) {
      this.loadError.set(problemMessage(error));
    }
  }

  private async act(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
    } catch (error) {
      this.actionError.set(problemMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  private clearMessages(): void {
    this.status.set(null);
    this.actionError.set(null);
  }
}
