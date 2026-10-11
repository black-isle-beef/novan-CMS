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
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DsAlertComponent, DsSpinnerComponent } from '@black-isle-beef/novan-design-system';
import { saveDownload } from '@novan/admin-shell';
import { problemMessage, SpaceContext } from '@novan/admin-spaces';
import {
  type AuditActor,
  auditActionLabel,
  auditActionLabels,
  type AuditContentDiff,
  type AuditEvent,
  type AuditEventsQuery,
} from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { SettingsApi } from '../settings-api';

const PAGE_SIZE = 50;

/** The kinds of thing actions are about, for the "What" filter's groups, in this order. */
const KINDS: readonly [prefix: string, label: string][] = [
  ['entry', 'Pages'],
  ['release', 'Releases'],
  ['folder', 'Folders'],
  ['asset', 'Files'],
  ['form_submission', 'Form messages'],
  ['form_submissions', 'Form downloads'],
  ['form_settings', 'Form settings'],
  ['redirect', 'Redirects'],
  ['redirects', 'Redirect imports'],
  ['locale', 'Languages'],
  ['member', 'People'],
  ['space', 'Space'],
  ['view_as', 'Viewing as a role'],
  ['content_type', 'Content types'],
  ['block_type', 'Blocks'],
  ['api_token', 'API tokens'],
  ['webhook', 'Webhooks'],
  ['audit_log', 'Audit log'],
];

/** Kinds whose items open in the admin, by the item's id. */
interface Target {
  path: string;
  query: Record<string, string> | null;
}
const LINKS: Readonly<Record<string, (spaceId: string, id: string) => Target>> = {
  entry: (spaceId, id) => ({ path: `/spaces/${spaceId}/content/${id}`, query: null }),
  asset: (spaceId, id) => ({ path: `/spaces/${spaceId}/media`, query: { asset: id } }),
};

const ukTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' });

const changeWords = { added: 'Added', removed: 'Removed', changed: 'Changed', moved: 'Moved' } as const;

interface Filters {
  actor: string;
  action: string;
  from: string;
  to: string;
}

/**
 * The audit log (docs/build/18-search-forms-audit.md): who changed what in the space, and when, newest first. Space
 * admins (and agency staff) filter it by person, by what happened and by UK day, download it as a spreadsheet, and open
 * an event to see what it recorded; for a publish or a restore, also what changed in the page. The route guard, the API
 * and RLS all keep it to admins.
 */
@Component({
  selector: 'nv-audit-log-page',
  imports: [DsAlertComponent, DsSpinnerComponent, ReactiveFormsModule, RouterLink],
  templateUrl: './audit-log-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuditLogPage {
  private readonly api = inject(SettingsApi);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  protected readonly context = inject(SpaceContext);

  /** Bound from the `:spaceId` route parameter. */
  readonly spaceId = input.required<string>();

  protected readonly events = signal<AuditEvent[] | null>(null);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly actors = signal<AuditActor[]>([]);
  protected readonly loadError = signal<string | null>(null);
  protected readonly status = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly busy = signal(false);
  /** The filters the list shows, as last applied. */
  private readonly applied = signal<Filters>({ actor: '', action: '', from: '', to: '' });
  /** The event whose details are open, and its content change once loaded. */
  protected readonly openId = signal<string | null>(null);
  protected readonly contentDiff = signal<AuditContentDiff | null>(null);
  protected readonly contentDiffError = signal<string | null>(null);

  protected readonly filters = inject(NonNullableFormBuilder).group({ actor: '', action: '', from: '', to: '' });
  protected readonly datesInvalid = signal(false);
  protected readonly filtered = computed(() => Object.values(this.applied()).some(Boolean));
  protected readonly label = auditActionLabel;

  /** The "What" filter: each kind of thing, then its actions. */
  protected readonly actionGroups = KINDS.map(([prefix, label]) => ({
    prefix,
    label,
    actions: Object.keys(auditActionLabels)
      .filter((action) => action.split('.')[0] === prefix)
      .map((action) => ({ action, label: auditActionLabels[action] })),
  })).filter((group) => group.actions.length);

  private readonly detailHeading = viewChild<ElementRef<HTMLElement>>('detailHeading');

  constructor() {
    effect(() => {
      const spaceId = this.spaceId();
      untracked(() => {
        this.context.currentSpaceId.set(spaceId);
        void this.load(spaceId);
      });
    });
  }

  protected when(iso: string): string {
    return ukTime.format(new Date(iso));
  }

  protected who(event: AuditEvent): string {
    if (!event.actorId) return 'Novan CMS';
    return event.actorName ?? 'Someone no longer in this space';
  }

  /** A short name for what the event was about, from what it recorded. */
  protected item(event: AuditEvent): string {
    const diff = event.diff ?? {};
    for (const key of ['name', 'title', 'path', 'slug', 'filename', 'code', 'fromPath', 'formName', 'email']) {
      const value = diff[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
    return event.targetType ? event.targetType.replace(/_/g, ' ') : '';
  }

  protected link(event: AuditEvent): Target | null {
    const kind = event.targetType ?? '';
    return event.targetId && LINKS[kind] && !/\.(deleted|purged)$/.test(event.action) ? LINKS[kind](this.spaceId(), event.targetId) : null;
  }

  /** What the event recorded, one line per key. */
  protected details(event: AuditEvent): { key: string; value: string }[] {
    return Object.entries(event.diff ?? {}).map(([key, value]) => ({ key, value: show(value) }));
  }

  protected changeWord(kind: keyof typeof changeWords): string {
    return changeWords[kind];
  }

  protected path(parts: string[]): string {
    return parts.join(' › ');
  }

  protected show(value: unknown): string {
    return show(value);
  }

  protected async apply(): Promise<void> {
    const values = this.filters.getRawValue();
    this.datesInvalid.set(Boolean(values.from && values.to && values.from > values.to));
    if (this.datesInvalid()) return;
    this.applied.set(values);
    this.clearMessages();
    await this.loadEvents(this.spaceId());
    this.status.set(this.filtered() ? 'The list shows only the changes you chose.' : 'The list shows every change.');
  }

  protected async clear(): Promise<void> {
    this.filters.reset({ actor: '', action: '', from: '', to: '' });
    this.datesInvalid.set(false);
    await this.apply();
  }

  protected async more(): Promise<void> {
    const cursor = this.nextCursor();
    if (!cursor) return;
    await this.act(async () => {
      const page = await firstValueFrom(this.api.auditEvents(this.spaceId(), { ...this.query(), cursor, limit: PAGE_SIZE }));
      this.events.update((list) => [...(list ?? []), ...page.items]);
      this.nextCursor.set(page.nextCursor);
    });
  }

  protected async toggle(event: AuditEvent): Promise<void> {
    if (this.openId() === event.id) {
      this.openId.set(null);
      return;
    }
    this.openId.set(event.id);
    this.contentDiff.set(null);
    this.contentDiffError.set(null);
    afterNextRender(() => this.detailHeading()?.nativeElement.focus(), { injector: this.injector });
  }

  protected async loadContentDiff(event: AuditEvent): Promise<void> {
    this.contentDiffError.set(null);
    try {
      this.contentDiff.set(await firstValueFrom(this.api.auditContentDiff(this.spaceId(), event.id)));
    } catch (error) {
      this.contentDiffError.set(problemMessage(error));
    }
  }

  protected async download(): Promise<void> {
    this.clearMessages();
    await this.act(async () => {
      saveDownload(this.document, await firstValueFrom(this.api.exportAudit(this.spaceId(), this.query())));
      this.status.set('The audit log is downloading as a spreadsheet (CSV).');
    });
  }

  /** The applied filters, without the empty ones. */
  private query(): AuditEventsQuery {
    const { actor, action, from, to } = this.applied();
    return { actor: actor || undefined, action: action || undefined, from: from || undefined, to: to || undefined };
  }

  private async load(spaceId: string): Promise<void> {
    this.loadError.set(null);
    this.clearMessages();
    try {
      this.actors.set(await firstValueFrom(this.api.auditActors(spaceId)));
    } catch (error) {
      this.loadError.set(problemMessage(error));
      return;
    }
    await this.loadEvents(spaceId);
  }

  private async loadEvents(spaceId: string): Promise<void> {
    this.events.set(null);
    this.openId.set(null);
    try {
      const page = await firstValueFrom(this.api.auditEvents(spaceId, { ...this.query(), limit: PAGE_SIZE }));
      this.events.set(page.items);
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

/** A recorded value as readable text: strings as they are, anything else as compact JSON. */
function show(value: unknown): string {
  if (value === undefined || value === null) return '—';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 400 ? `${text.slice(0, 399)}…` : text;
}
