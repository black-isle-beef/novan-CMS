import { DatePipe } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  effect,
  type ElementRef,
  inject,
  Injector,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DsAlertComponent, DsBadgeComponent, DsSpinnerComponent } from '@black-isle-beef/novan-design-system';
import { Confirm } from '@novan/admin-shell';
import { problemMessage, SpaceContext } from '@novan/admin-spaces';
import {
  type Webhook,
  type WebhookDelivery,
  type WebhookEventType,
  webhookEventLabels,
  webhookEventTypes,
  type WebhookWithSecret,
} from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { SettingsApi } from '../settings-api';

/** An address is a full http(s) URL. */
const urlPattern = /^https?:\/\/\S+$/;

/**
 * The space's webhooks (docs/build/17-scheduling-releases-webhooks.md): addresses called when content changes, each with
 * the events it receives and a secret that signs its requests (shown once, when made or replaced; docs/webhooks.md).
 * Each has a delivery log, where a failed request can be sent again. For admins, developers and agency staff; the
 * route guard, the API and RLS agree.
 */
@Component({
  selector: 'nv-webhooks-page',
  imports: [DatePipe, DsAlertComponent, DsBadgeComponent, DsSpinnerComponent, ReactiveFormsModule],
  templateUrl: './webhooks-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WebhooksPage {
  private readonly api = inject(SettingsApi);
  private readonly confirm = inject(Confirm);
  private readonly injector = inject(Injector);
  protected readonly context = inject(SpaceContext);

  /** Bound from the `:spaceId` route parameter. */
  readonly spaceId = input.required<string>();

  protected readonly eventTypes = webhookEventTypes;
  protected readonly eventLabels = webhookEventLabels;
  protected readonly webhooks = signal<Webhook[] | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly status = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);
  protected readonly events = signal<ReadonlySet<WebhookEventType>>(new Set(['entry.published', 'entry.unpublished']));
  /** A webhook just made, or whose secret was just replaced, with its secret, until the page is left. */
  protected readonly secretShown = signal<WebhookWithSecret | null>(null);
  protected readonly copyStatus = signal<string | null>(null);
  /** The webhook whose delivery log is open, and the log. */
  protected readonly logOf = signal<Webhook | null>(null);
  protected readonly log = signal<WebhookDelivery[] | null>(null);
  protected readonly logError = signal<string | null>(null);

  private readonly secretHeading = viewChild<ElementRef<HTMLElement>>('secretHeading');
  private readonly logHeading = viewChild<ElementRef<HTMLElement>>('logHeading');

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    url: ['', [Validators.required, Validators.pattern(urlPattern), Validators.maxLength(2000)]],
  });

  constructor() {
    effect(() => {
      const spaceId = this.spaceId();
      untracked(() => {
        this.context.currentSpaceId.set(spaceId);
        void this.load(spaceId);
      });
    });
  }

  protected invalid(control: 'name' | 'url'): boolean {
    return this.submitted() && this.form.controls[control].invalid;
  }

  protected eventsInvalid(): boolean {
    return this.submitted() && this.events().size === 0;
  }

  protected toggleEvent(type: WebhookEventType, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.events.update((current) => {
      const next = new Set(current);
      if (checked) next.add(type);
      else next.delete(type);
      return next;
    });
  }

  protected eventSummary(webhook: Webhook): string {
    return webhook.events.map((type) => this.eventLabels[type]).join('; ');
  }

  protected async create(): Promise<void> {
    this.submitted.set(true);
    this.clearMessages();
    if (this.form.invalid || this.events().size === 0) return;
    const { name, url } = this.form.getRawValue();
    await this.act(async () => {
      const created = await firstValueFrom(
        this.api.createWebhook(this.spaceId(), { name: name.trim(), url: url.trim(), events: this.eventTypes.filter((t) => this.events().has(t)) }),
      );
      this.webhooks.update((list) => [...(list ?? []), created]);
      this.form.reset();
      this.submitted.set(false);
      this.showSecret(created);
    });
  }

  protected async setActive(webhook: Webhook, active: boolean): Promise<void> {
    this.clearMessages();
    await this.act(async () => {
      this.replace(await firstValueFrom(this.api.updateWebhook(this.spaceId(), webhook.id, { active })));
      this.status.set(active ? `${webhook.name} is on again.` : `${webhook.name} is off. Nothing is sent to it until you turn it on.`);
    });
  }

  protected async rotate(webhook: Webhook): Promise<void> {
    this.clearMessages();
    const confirmed = await this.confirm.ask({
      heading: `Replace the secret of ${webhook.name}?`,
      body: 'Requests are signed with the new secret straight away. The receiver must use it to check them, or it will refuse them.',
      confirmLabel: 'Replace secret',
      destructive: true,
    });
    if (!confirmed) return;
    await this.act(async () => this.showSecret(await firstValueFrom(this.api.rotateWebhookSecret(this.spaceId(), webhook.id))));
  }

  protected async remove(webhook: Webhook): Promise<void> {
    this.clearMessages();
    const confirmed = await this.confirm.ask({
      heading: `Delete ${webhook.name}?`,
      body: 'Nothing more is sent to it, and its delivery log is deleted. You cannot undo this.',
      confirmLabel: 'Delete webhook',
      destructive: true,
    });
    if (!confirmed) return;
    await this.act(async () => {
      await firstValueFrom(this.api.deleteWebhook(this.spaceId(), webhook.id));
      this.webhooks.update((list) => (list ?? []).filter((w) => w.id !== webhook.id));
      if (this.logOf()?.id === webhook.id) this.logOf.set(null);
      if (this.secretShown()?.id === webhook.id) this.secretShown.set(null);
      this.status.set(`${webhook.name} is deleted.`);
    });
  }

  protected async test(webhook: Webhook): Promise<void> {
    this.clearMessages();
    await this.act(async () => {
      await firstValueFrom(this.api.testWebhook(this.spaceId(), webhook.id));
      this.status.set(`A test was sent to ${webhook.name}. Its result appears in the delivery log within a few seconds.`);
      await this.openLog(webhook, false);
    });
  }

  protected async openLog(webhook: Webhook, focus = true): Promise<void> {
    this.logOf.set(webhook);
    this.log.set(null);
    this.logError.set(null);
    try {
      this.log.set(await firstValueFrom(this.api.webhookDeliveries(this.spaceId(), webhook.id)));
    } catch (error) {
      this.logError.set(problemMessage(error));
    }
    if (focus) afterNextRender(() => this.logHeading()?.nativeElement.focus(), { injector: this.injector });
  }

  protected async resend(delivery: WebhookDelivery): Promise<void> {
    const webhook = this.logOf();
    if (!webhook) return;
    this.clearMessages();
    await this.act(async () => {
      await firstValueFrom(this.api.resendWebhookDelivery(this.spaceId(), webhook.id, delivery.id));
      this.status.set('Sent again. The new delivery is at the top of the log.');
      await this.openLog(webhook, false);
    });
  }

  protected async copy(field: HTMLInputElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(field.value);
      this.copyStatus.set('Copied to the clipboard.');
    } catch {
      field.select();
      this.copyStatus.set('Your browser did not allow copying. The secret is selected: copy it with Ctrl+C or Cmd+C.');
    }
  }

  protected result(delivery: WebhookDelivery): string {
    const code = delivery.responseCode ? ` (${delivery.responseCode})` : '';
    switch (delivery.status) {
      case 'delivered':
        return `Delivered${code}`;
      case 'failed':
        return `Failed${code}`;
      default:
        return delivery.attempt ? `Retrying${code}` : 'Waiting to send';
    }
  }

  private showSecret(webhook: WebhookWithSecret): void {
    this.secretShown.set(webhook);
    this.copyStatus.set(null);
    // Take keyboard and screen reader users to the secret they need to copy.
    afterNextRender(() => this.secretHeading()?.nativeElement.focus(), { injector: this.injector });
  }

  private replace(webhook: Webhook): void {
    this.webhooks.update((list) => (list ?? []).map((w) => (w.id === webhook.id ? webhook : w)));
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

  private async load(spaceId: string): Promise<void> {
    this.webhooks.set(null);
    this.loadError.set(null);
    this.secretShown.set(null);
    this.logOf.set(null);
    this.clearMessages();
    try {
      this.webhooks.set(await firstValueFrom(this.api.listWebhooks(spaceId)));
    } catch (error) {
      this.loadError.set(problemMessage(error));
    }
  }

  private clearMessages(): void {
    this.status.set(null);
    this.actionError.set(null);
  }
}
