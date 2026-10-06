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
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DsAlertComponent, DsBadgeComponent, DsButtonComponent, DsModalComponent } from '@black-isle-beef/novan-design-system';
import { describePath, errorsFromIssues, FieldForm, FieldFormContext, fieldId } from '@novan/admin-fields';
import { MediaPicker, MediaPickerDialog } from '@novan/admin-media';
import { Confirm, copy, type HasUnsavedChanges, Shortcuts, shortcutKeys, Skeleton, warnBeforeUnload } from '@novan/admin-shell';
import { problemCode, problemFieldErrors, problemMessage, SpaceContext } from '@novan/admin-spaces';
import {
  type BlockType,
  buildEntrySchema,
  type ContentType,
  type Entry,
  type EntryData,
  entryTitle,
  type Folder,
  sameJson,
} from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { ContentApi } from '../content-api';
import { statusBadges } from '../content-tree';
import { VersionHistory } from '../version-history/version-history';

/** How long after the last change autosave waits. */
const AUTOSAVE_DELAY_MS = 3000;

type Check = 'draft' | 'publish';

interface Summary {
  check: Check;
  items: { href: string; text: string }[];
}

const clock = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

/**
 * Edits one page or entry in a form generated from its content type: save draft (and autosave),
 * publish, unpublish, move, delete, and the version history. Drafts may be incomplete; publishing checks
 * every required field. Errors use the same `buildEntrySchema` as the API. Ctrl+S saves and Ctrl+Shift+P publishes;
 * leaving with unsaved changes asks first.
 */
@Component({
  selector: 'nv-entry-editor-page',
  imports: [
    DsAlertComponent,
    DsBadgeComponent,
    DsButtonComponent,
    DsModalComponent,
    FieldForm,
    MediaPickerDialog,
    RouterLink,
    Skeleton,
    VersionHistory,
  ],
  providers: [FieldFormContext, MediaPicker],
  templateUrl: './entry-editor-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntryEditorPage implements HasUnsavedChanges {
  private readonly api = inject(ContentApi);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly form = inject(FieldFormContext);
  private readonly media = inject(MediaPicker);
  private readonly confirm = inject(Confirm);
  protected readonly context = inject(SpaceContext);
  protected readonly copy = copy;
  protected readonly shortcutKeys = shortcutKeys;

  /** Route parameters (component input binding). */
  readonly spaceId = input.required<string>();
  readonly entryId = input.required<string>();

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly entry = signal<Entry | null>(null);
  protected readonly contentType = signal<ContentType | null>(null);
  protected readonly blockTypes = signal<BlockType[]>([]);
  protected readonly folders = signal<Folder[]>([]);

  /** The form's working copy, and what was last saved (or loaded). */
  protected readonly data = signal<EntryData>({});
  private readonly saved = signal<EntryData>({});
  protected readonly dirty = computed(() => !sameJson(this.data(), this.saved()));

  protected readonly busy = signal<'saving' | 'autosaving' | 'publishing' | null>(null);
  private readonly savedAt = signal<Date | null>(null);
  protected readonly status = signal<string | null>(null);
  protected readonly problem = signal<string | null>(null);
  private readonly check = signal<Check | null>(null);
  private readonly serverErrors = signal<Record<string, string[]>>({});

  protected readonly historyOpen = signal(false);
  protected readonly confirmingDelete = signal(false);
  protected readonly moveTo = signal<string | null>(null);

  protected readonly title = computed(() => entryTitle(this.data(), this.entry()?.slug ?? ''));
  protected readonly badges = computed(() => {
    const entry = this.entry();
    return entry ? statusBadges(entry) : [];
  });
  protected readonly canEdit = computed(() => this.context.canEditCurrent());
  protected readonly canPublish = computed(() => this.context.canPublishCurrent());
  protected readonly published = computed(() => this.entry()?.status === 'published');
  /** The published page on the space's site, or null when it is not published or the site is unknown. */
  protected readonly liveUrl = computed(() => {
    const origin = this.context.currentSpace()?.previewUrl;
    const path = this.entry()?.publishedPath;
    if (!this.published() || !path || !origin || !/^https?:\/\//i.test(origin)) return null;
    return `${origin.replace(/\/+$/, '')}${path}`;
  });
  /** The live page only matches the form once every change is saved and published. */
  protected readonly liveIsCurrent = computed(() => !this.dirty() && !this.entry()?.hasUnpublishedChanges);
  /** Moving a published page changes its address straight away, so it needs an editor. */
  protected readonly canMove = computed(() => (this.published() ? this.canPublish() : this.canEdit()));

  private readonly schemas = computed(() => {
    const type = this.contentType();
    if (!type) return null;
    const blockTypes = this.blockTypes();
    // Media items are checked against the previews the form has loaded (kind, alt text, still there).
    this.form.assets();
    const assets = (id: string) => this.form.assetInfo(id);
    return {
      draft: buildEntrySchema(type.fields, { blockTypes, draft: true, assets }),
      publish: buildEntrySchema(type.fields, { blockTypes, assets }),
    };
  });

  /** Field errors for the check last asked for (save or publish), plus those the API reported. */
  private readonly errors = computed<Record<string, string[]>>(() => {
    const check = this.check();
    const schemas = this.schemas();
    const local =
      check && schemas
        ? (() => {
            const result = schemas[check].safeParse(this.data());
            return result.success ? {} : errorsFromIssues(result.error.issues);
          })()
        : {};
    return { ...local, ...this.serverErrors() };
  });

  protected readonly summary = computed<Summary | null>(() => {
    const errors = this.errors();
    const type = this.contentType();
    if (!type || !Object.keys(errors).length) return null;
    const items = Object.entries(errors).flatMap(([path, messages]) =>
      messages.map((message) => ({
        href: `#${fieldId(path)}`,
        text: `${describePath(path, type.fields, this.data(), this.blockTypes())}: ${message}`,
      })),
    );
    return { check: this.check() ?? 'draft', items };
  });

  protected readonly saveState = computed(() => {
    switch (this.busy()) {
      case 'saving':
      case 'autosaving':
        return 'Saving…';
      case 'publishing':
        return 'Publishing…';
    }
    if (this.dirty()) return this.canEdit() ? 'Changes not saved yet.' : '';
    const at = this.savedAt();
    return at ? `All changes saved at ${clock.format(at)}.` : '';
  });

  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set once the page is deleted, so leaving does not ask about its unsaved changes. */
  private discarded = false;

  constructor() {
    effect(() => {
      const spaceId = this.spaceId();
      const entryId = this.entryId();
      untracked(() => {
        this.context.currentSpaceId.set(spaceId);
        this.media.connect(this.form, spaceId);
        void this.load(spaceId, entryId);
      });
    });
    effect(() => this.form.errors.set(this.errors()));
    effect(() => this.form.readonly.set(!this.canEdit()));
    // Autosave a few seconds after the last change.
    effect(() => {
      const due = this.dirty() && this.canEdit() && this.entry() !== null;
      this.data();
      untracked(() => this.scheduleAutosave(due));
    });
    inject(DestroyRef).onDestroy(() => this.cancelAutosave());
    const shortcuts = inject(Shortcuts);
    shortcuts.register('save', () => void this.save());
    shortcuts.register('publish', () => void this.publish());
    warnBeforeUnload(() => this.hasUnsavedChanges());
  }

  /** Changes the person could still lose: typed but not saved (autosave may be pending). */
  hasUnsavedChanges(): boolean {
    return !this.discarded && this.canEdit() && this.dirty();
  }

  protected setData(data: Record<string, unknown>): void {
    this.data.set(data);
    this.serverErrors.set({});
    this.status.set(null);
  }

  protected setMoveTo(event: Event): void {
    this.moveTo.set((event.target as HTMLSelectElement).value || null);
  }

  protected async save(): Promise<void> {
    if (!this.canEdit() || this.busy()) return;
    if (!this.checkFor('draft')) return;
    this.cancelAutosave();
    const data = this.data();
    await this.run('saving', async () => {
      const entry = await firstValueFrom(this.api.saveEntry(this.spaceId(), this.entryId(), data));
      this.afterSave(entry, data);
      this.status.set('Draft saved.');
      this.focus('entry-status');
    });
  }

  protected async publish(): Promise<void> {
    if (!this.canPublish() || this.busy()) return;
    if (!this.checkFor('publish')) return;
    this.cancelAutosave();
    const data = this.data();
    await this.run('publishing', async () => {
      if (this.dirty()) this.afterSave(await firstValueFrom(this.api.saveEntry(this.spaceId(), this.entryId(), data)), data);
      const entry = await firstValueFrom(this.api.publish(this.spaceId(), this.entryId()));
      this.entry.set(entry);
      this.status.set(`Published. It is live at ${entry.publishedPath}.`);
      this.focus('entry-status');
    });
  }

  protected async unpublish(): Promise<void> {
    if (!this.canPublish() || this.busy()) return;
    const confirmed = await this.confirm.ask({
      heading: `Unpublish ${this.title()}?`,
      body: 'It comes off the live site straight away. The draft is kept, and you can publish it again later.',
      confirmLabel: copy.unpublish,
      destructive: true,
    });
    if (!confirmed) return;
    await this.run('saving', async () => {
      this.entry.set(await firstValueFrom(this.api.unpublish(this.spaceId(), this.entryId())));
      this.status.set('Unpublished. It is no longer on the site; the draft is kept.');
      this.focus('entry-status');
    });
  }

  protected async move(): Promise<void> {
    const entry = this.entry();
    if (!entry || !this.canMove() || this.moveTo() === entry.folderId) return;
    await this.run('saving', async () => {
      const moved = await firstValueFrom(this.api.moveEntry(this.spaceId(), entry.id, this.moveTo()));
      this.entry.set(moved);
      this.status.set(`Moved. The address is now ${moved.path}.`);
      this.focus('entry-status');
    });
  }

  protected async remove(): Promise<void> {
    this.confirmingDelete.set(false);
    this.cancelAutosave();
    await this.run('saving', async () => {
      await firstValueFrom(this.api.deleteEntry(this.spaceId(), this.entryId()));
      this.discarded = true;
      await this.router.navigate(['/spaces', this.spaceId(), 'content']);
    });
  }

  protected restored(entry: Entry): void {
    this.cancelAutosave();
    this.entry.set(entry);
    this.data.set(entry.data);
    this.saved.set(entry.data);
    this.serverErrors.set({});
    this.check.set(null);
    this.status.set('Version restored. It is now the current draft.');
    this.focus('entry-status');
  }

  /** Runs the local check; on failure shows and focuses the error summary. */
  private checkFor(check: Check): boolean {
    this.status.set(null);
    this.problem.set(null);
    this.serverErrors.set({});
    this.check.set(check);
    if (!this.summary()) return true;
    this.focus('entry-errors');
    return false;
  }

  private async run(busy: 'saving' | 'publishing', action: () => Promise<void>): Promise<void> {
    this.busy.set(busy);
    this.problem.set(null);
    try {
      await action();
    } catch (error) {
      this.showFailure(error);
    } finally {
      this.busy.set(null);
    }
  }

  private showFailure(error: unknown): void {
    const fields = problemFieldErrors(error);
    if (problemCode(error) === 'entry_invalid' && Object.keys(fields).length) {
      this.serverErrors.set(fields);
      this.focus('entry-errors');
      return;
    }
    this.problem.set(problemMessage(error));
    this.focus('entry-problem');
  }

  private afterSave(entry: Entry, data: EntryData): void {
    this.entry.set(entry);
    this.saved.set(data);
    this.savedAt.set(new Date());
  }

  private scheduleAutosave(due: boolean): void {
    this.cancelAutosave();
    if (due) this.autosaveTimer = setTimeout(() => void this.autosave(), AUTOSAVE_DELAY_MS);
  }

  private cancelAutosave(): void {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = null;
  }

  /** Saves quietly; a draft with malformed values is left for the person to fix and save. */
  private async autosave(): Promise<void> {
    this.autosaveTimer = null;
    const schemas = this.schemas();
    if (this.busy() || !this.dirty() || !schemas) return;
    const data = this.data();
    if (!schemas.draft.safeParse(data).success) {
      this.check.set('draft');
      return;
    }
    this.busy.set('autosaving');
    try {
      this.afterSave(await firstValueFrom(this.api.autosaveEntry(this.spaceId(), this.entryId(), data)), data);
    } catch (error) {
      this.showFailure(error);
    } finally {
      this.busy.set(null);
    }
  }

  private async load(spaceId: string, entryId: string): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    this.cancelAutosave();
    try {
      const [entry, types, blocks, entries, folders] = await Promise.all([
        firstValueFrom(this.api.getEntry(spaceId, entryId)),
        firstValueFrom(this.api.listContentTypes(spaceId)),
        firstValueFrom(this.api.listBlockTypes(spaceId)),
        firstValueFrom(this.api.listEntries(spaceId)),
        firstValueFrom(this.api.listFolders(spaceId)),
      ]);
      const type = types.find((t) => t.apiId === entry.contentType) ?? null;
      if (!type) {
        this.loadError.set('The type of this page no longer exists.');
        return;
      }
      this.contentType.set(type);
      this.blockTypes.set(blocks);
      this.folders.set(folders);
      this.form.blockTypes.set(blocks);
      this.form.entries.set(entries.map(({ id, title, contentType, path }) => ({ id, title, contentType, path })));
      this.entry.set(entry);
      this.data.set(entry.data);
      this.saved.set(entry.data);
      this.moveTo.set(entry.folderId);
    } catch (error) {
      this.loadError.set(problemMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  private focus(elementId: string): void {
    afterNextRender(() => this.host.nativeElement.ownerDocument.getElementById(elementId)?.focus(), {
      injector: this.injector,
    });
  }
}
