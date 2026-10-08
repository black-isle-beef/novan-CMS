import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { DsAlertComponent, DsModalComponent, DsSpinnerComponent } from '@black-isle-beef/novan-design-system';
import { Confirm, copy, shortcutKeys } from '@novan/admin-shell';
import { problemMessage } from '@novan/admin-spaces';
import { type BlockType, type ContentType, type Entry, type EntryWorkflow, sitePath, type WorkflowAction } from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { type SideBySideRow, sideBySide } from '../change-text';
import type { CheckItem } from '../checklist/checklist';
import { PublishChecklist } from '../checklist/publish-checklist';
import { ContentApi } from '../content-api';

/** The actions that open a dialog. */
export type WorkflowDialog = Extract<WorkflowAction, 'publish' | 'approve' | 'submit' | 'requestChanges'>;
type Dialog = WorkflowDialog;

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * A page's place in the publishing workflow (docs/build/13-workflow-publishing.md), for the form view and the visual
 * editor: where it stands (waiting for review, changes asked for), the actions the API says the person may take, and
 * their dialogs. Publishing shows what changed since the live version side by side, the pre-publish checklist and an
 * optional message for the version; unpublishing names the pages that link here. Before an action the page saves
 * its unsaved changes through `prepare`.
 */
@Component({
  selector: 'nv-page-workflow',
  imports: [DsAlertComponent, DsModalComponent, DsSpinnerComponent, NgTemplateOutlet, PublishChecklist],
  templateUrl: './page-workflow.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageWorkflow {
  private readonly api = inject(ContentApi);
  private readonly confirm = inject(Confirm);
  protected readonly copy = copy;
  protected readonly shortcutKeys = shortcutKeys;

  readonly spaceId = input.required<string>();
  readonly entry = input.required<Entry>();
  readonly contentType = input.required<ContentType>();
  readonly blockTypes = input<readonly BlockType[]>([]);
  /** The pre-publish checklist; errors stop publishing. */
  readonly checks = input<readonly CheckItem[]>([]);
  /**
   * Readies the page for an action (saves unsaved changes, checks it is complete enough); resolves false when it is
   * not ready, and the page says why.
   */
  readonly prepare = input<(action: Dialog) => Promise<boolean>>(() => Promise.resolve(true));
  /** Another action of the page is running. */
  readonly disabled = input(false);
  /** Hide actions the page shows elsewhere. */
  readonly compact = input(false);

  /** The page after an action. */
  readonly changed = output<Entry>();
  /** A finished action, in words, for the page's status message. */
  readonly done = output<string>();
  readonly goTo = output<string>();

  protected readonly workflow = signal<EntryWorkflow | null>(null);
  protected readonly dialog = signal<Dialog | null>(null);
  protected readonly busy = signal(false);
  protected readonly problem = signal<string | null>(null);
  protected readonly message = signal('');
  protected readonly comment = signal('');
  protected readonly commentError = signal(false);
  /** Changes since the live version: null while loading, [] for a page that is not live yet. */
  protected readonly changes = signal<SideBySideRow[] | null>(null);
  protected readonly changesError = signal<string | null>(null);
  protected readonly comparing = signal(false);

  protected readonly can = (action: WorkflowAction): boolean => this.workflow()?.actions.includes(action) ?? false;
  protected readonly errors = computed(() => this.checks().filter((item) => item.severity === 'error').length);
  protected readonly review = computed(() => this.workflow()?.review ?? null);
  protected readonly waiting = computed(() => this.workflow()?.state === 'in_review');
  protected readonly sentBack = computed(() => {
    const review = this.review();
    return !this.waiting() && review?.decision === 'changes_requested' ? review : null;
  });
  /** The live page differs from the draft, so there is something to compare. */
  protected readonly comparable = computed(() => {
    const entry = this.entry();
    return entry.publishedVersionId !== null && entry.publishedVersionId !== entry.currentVersionId;
  });
  protected readonly publishLabel = computed(() => (this.entry().publishedVersionId ? copy.publishChanges : copy.publish));

  constructor() {
    // Reload when the page changes state or version.
    effect(() => {
      const entry = this.entry();
      const key = `${entry.id}:${entry.status}:${entry.currentVersionId}:${entry.publishedVersionId}`;
      untracked(() => void this.load(key));
    });
  }

  protected time(iso: string): string {
    return when.format(new Date(iso));
  }

  /** Opens the publish dialog (the Ctrl+Shift+P shortcut lands here). */
  async openPublish(): Promise<void> {
    if (this.can('approve')) return this.open('approve');
    if (this.can('publish')) return this.open('publish');
  }

  protected async open(dialog: Dialog): Promise<void> {
    if (this.busy() || this.disabled()) return;
    this.problem.set(null);
    if (!(await this.prepare()(dialog))) return;
    this.message.set('');
    this.comment.set('');
    this.commentError.set(false);
    this.dialog.set(dialog);
    if (dialog === 'publish' || dialog === 'approve') void this.loadChanges();
  }

  protected close(): void {
    this.dialog.set(null);
  }

  protected setMessage(event: Event): void {
    this.message.set((event.target as HTMLTextAreaElement).value);
  }

  protected setComment(event: Event): void {
    this.comment.set((event.target as HTMLTextAreaElement).value);
    this.commentError.set(false);
  }

  protected async confirmDialog(): Promise<void> {
    const dialog = this.dialog();
    const message = this.message().trim() || null;
    const { spaceId, id, title } = { spaceId: this.spaceId(), id: this.entry().id, title: this.entry().title };
    switch (dialog) {
      case 'publish':
      case 'approve':
        if (this.errors()) return;
        await this.run(async () => {
          const entry = await firstValueFrom(dialog === 'approve' ? this.api.approve(spaceId, id, message) : this.api.publish(spaceId, id, message));
          return { entry, done: `${dialog === 'approve' ? 'Approved and published' : 'Published'}. It is live at ${sitePath(entry.publishedPath ?? entry.path)}.` };
        });
        return;
      case 'submit':
        await this.run(async () => ({
          entry: await firstValueFrom(this.api.submit(spaceId, id, message)),
          done: `Sent for review. A space admin has been told; you will get an email when they decide.`,
        }));
        return;
      case 'requestChanges': {
        const comment = this.comment().trim();
        if (!comment) {
          this.commentError.set(true);
          return;
        }
        await this.run(async () => ({
          entry: await firstValueFrom(this.api.requestChanges(spaceId, id, comment)),
          done: `Changes requested. ${title} is back with whoever sent it, with your comment.`,
        }));
        return;
      }
    }
  }

  protected async unpublish(): Promise<void> {
    if (this.busy() || this.disabled()) return;
    const entry = this.entry();
    let linking: string;
    try {
      const references = await firstValueFrom(this.api.references(this.spaceId(), entry.id));
      linking = references.length
        ? ` These link to it, and their links will lead nowhere: ${references.map((r) => `${r.title} (${sitePath(r.path)})`).join(', ')}.`
        : ' No other pages link to it.';
    } catch {
      linking = '';
    }
    const confirmed = await this.confirm.ask({
      heading: `Unpublish ${entry.title}?`,
      body: `It comes off the live site straight away. The draft is kept, and you can publish it again later.${linking}`,
      confirmLabel: copy.unpublish,
      destructive: true,
    });
    if (!confirmed) return;
    await this.run(async () => ({
      entry: await firstValueFrom(this.api.unpublish(this.spaceId(), entry.id)),
      done: 'Unpublished. It is no longer on the site; the draft is kept.',
    }));
  }

  protected async archive(): Promise<void> {
    if (this.busy() || this.disabled()) return;
    const entry = this.entry();
    const confirmed = await this.confirm.ask({
      heading: `Archive ${entry.title}?`,
      body: `${entry.publishedVersionId ? 'It comes off the live site, and it' : 'It'} cannot be changed until it is restored. Nothing is deleted.`,
      confirmLabel: 'Archive',
      destructive: true,
    });
    if (!confirmed) return;
    await this.run(async () => ({ entry: await firstValueFrom(this.api.archive(this.spaceId(), entry.id)), done: 'Archived.' }));
  }

  protected async unarchive(): Promise<void> {
    await this.run(async () => ({
      entry: await firstValueFrom(this.api.unarchive(this.spaceId(), this.entry().id)),
      done: 'Restored as a draft.',
    }));
  }

  protected async toggleCompare(): Promise<void> {
    this.comparing.update((open) => !open);
    if (this.comparing()) await this.loadChanges();
  }

  private async run(action: () => Promise<{ entry: Entry; done: string }>): Promise<void> {
    this.busy.set(true);
    this.problem.set(null);
    try {
      const { entry, done } = await action();
      this.dialog.set(null);
      this.changed.emit(entry);
      this.done.emit(done);
    } catch (error) {
      this.problem.set(problemMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  private async load(key: string): Promise<void> {
    try {
      const workflow = await firstValueFrom(this.api.workflow(this.spaceId(), this.entry().id));
      if (key === this.keyOf(this.entry())) this.workflow.set(workflow);
    } catch (error) {
      this.problem.set(problemMessage(error));
    }
  }

  private keyOf(entry: Entry): string {
    return `${entry.id}:${entry.status}:${entry.currentVersionId}:${entry.publishedVersionId}`;
  }

  private async loadChanges(): Promise<void> {
    const entry = this.entry();
    this.changes.set(null);
    this.changesError.set(null);
    if (!entry.publishedVersionId) {
      this.changes.set([]);
      return;
    }
    try {
      const diff = await firstValueFrom(this.api.diff(this.spaceId(), entry.publishedVersionId, entry.currentVersionId));
      this.changes.set(diff.changes.map((change) => sideBySide(change, this.contentType().fields, this.blockTypes())));
    } catch (error) {
      this.changesError.set(problemMessage(error));
    }
  }
}
