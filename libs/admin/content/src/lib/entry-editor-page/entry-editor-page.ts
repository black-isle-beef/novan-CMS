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
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DsAlertComponent, DsBadgeComponent, DsButtonComponent, DsModalComponent } from '@black-isle-beef/novan-design-system';
import { describePath, errorsFromIssues, FieldForm, FieldFormContext, fieldId, LocaleSwitcher } from '@novan/admin-fields';
import { MediaPicker, MediaPickerDialog } from '@novan/admin-media';
import { copy, type HasUnsavedChanges, Shortcuts, shortcutKeys, Skeleton, warnBeforeUnload } from '@novan/admin-shell';
import { problemCode, problemFieldErrors, problemMessage, SpaceContext, SpaceLocales } from '@novan/admin-spaces';
import {
  type BlockNode,
  type BlockType,
  buildEntrySchema,
  type ContentType,
  type Entry,
  type EntryData,
  entryTitle,
  type FieldDef,
  type Folder,
  LOCALE_CODE_PATTERN,
  localesMissingTranslations,
  localisedPath,
  mediaRefs,
  sameJson,
  sitePath,
} from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { ContentApi } from '../content-api';
import { statusBadges } from '../content-tree';
import { type CheckItem, pageChecks } from '../checklist/checklist';
import { VersionHistory } from '../version-history/version-history';
import { PageWorkflow, type WorkflowDialog } from '../workflow/page-workflow';

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
    LocaleSwitcher,
    MediaPickerDialog,
    PageWorkflow,
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
  protected readonly form = inject(FieldFormContext);
  private readonly media = inject(MediaPicker);
  protected readonly context = inject(SpaceContext);
  protected readonly spaceLocales = inject(SpaceLocales);
  protected readonly copy = copy;
  protected readonly shortcutKeys = shortcutKeys;

  /** Route parameters (component input binding). */
  readonly spaceId = input.required<string>();
  readonly entryId = input.required<string>();
  /** `?locale=`: the language to open the page in (from the visual editor). */
  readonly locale = input<string | undefined>();

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

  protected readonly title = computed(() => entryTitle(this.data(), this.entry()?.slug ?? '', this.form.defaultLocale()));
  /** Languages with translations missing, as the form stands. */
  protected readonly missingLocales = computed(() => {
    const type = this.contentType();
    const others = this.form.locales().filter((locale) => !locale.isDefault).map((locale) => locale.code);
    return type ? localesMissingTranslations(type.fields, this.data(), others, this.form.defaultLocale(), this.blockTypes()) : [];
  });
  /** Machine translation can fill the shown language's empty translations (when a translator is set up). */
  protected readonly canMachineTranslate = computed(
    () => this.canEdit() && this.spaceLocales.value()?.machineTranslation === true && this.form.locale() !== null,
  );
  /** The fields last filled in by machine translation, to check. */
  protected readonly machineTranslated = signal<{ locale: string; fields: string[] } | null>(null);
  protected readonly badges = computed(() => {
    const entry = this.entry();
    return entry ? statusBadges(entry) : [];
  });
  /** Archived pages are kept as they are until restored. */
  protected readonly canEdit = computed(() => this.context.canEditCurrent() && this.entry()?.status !== 'archived');
  protected readonly canPublish = computed(() => this.context.canPublishCurrent());
  private readonly workflowControls = viewChild<PageWorkflow>('workflow');

  /** The pre-publish checklist for the publish dialog: what stops publishing, and images without alternative text. */
  protected readonly checks = computed<CheckItem[]>(() => {
    const type = this.contentType();
    const schemas = this.schemas();
    if (!type || !schemas) return [];
    const data = this.data();
    const result = schemas.publish.safeParse(data);
    this.form.assets();
    const localeName = (code: string) => this.form.localeName(code);
    return pageChecks({
      errors: result.success ? {} : errorsFromIssues(result.error.issues),
      describe: (path) => describePath(path, type.fields, data, this.blockTypes(), localeName),
      blockAt: (path) => blockUidAt(data, path),
      media: mediaRefs(type.fields, data, this.blockTypes()),
      asset: (id) => this.form.assetInfo(id),
      describeMedia: (ref) => describeMediaPath(ref.path, type.fields, data, this.blockTypes(), localeName),
      headings: null,
    });
  });
  protected readonly published = computed(() => this.entry()?.status === 'published');
  /** The published page on the space's site, or null when it is not published or the site is unknown. */
  protected readonly liveUrl = computed(() => {
    const origin = this.context.currentSpace()?.previewUrl;
    const path = this.entry()?.publishedPath;
    if (!this.published() || !path || !origin || !/^https?:\/\//i.test(origin)) return null;
    const locales = this.spaceLocales.value();
    const address = locales ? localisedPath(sitePath(path), this.form.activeLocale(), locales) : sitePath(path);
    return `${origin.replace(/\/+$/, '')}${address}`;
  });
  /** Pages can be edited on the site itself, in the visual editor. */
  protected readonly isPage = computed(() => this.entry()?.kind === 'page');
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
    const locales = this.form.localeSettings();
    return {
      draft: buildEntrySchema(type.fields, { blockTypes, draft: true, assets, locales }),
      publish: buildEntrySchema(type.fields, { blockTypes, assets, locales }),
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
        text: `${describePath(path, type.fields, this.data(), this.blockTypes(), (code) => this.form.localeName(code))}: ${message}`,
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
    shortcuts.register('publish', () => void this.workflowControls()?.openPublish());
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

  /**
   * Readies the page for a workflow action: publishing and sending for review need every required field (the error
   * summary says what is missing) and unsaved changes saved first. Other actions take the page as it is saved.
   */
  protected readonly prepare = async (action: WorkflowDialog): Promise<boolean> => {
    if (action === 'requestChanges') return true;
    if (!this.checkFor('publish')) return false;
    if (!this.dirty() || !this.canEdit()) return true;
    this.cancelAutosave();
    const data = this.data();
    let saved = false;
    await this.run('saving', async () => {
      this.afterSave(await firstValueFrom(this.api.saveEntry(this.spaceId(), this.entryId(), data)), data);
      saved = true;
    });
    return saved;
  };

  /**
   * Fills the shown language's empty translations by machine. The API translates the saved draft, so unsaved changes
   * are saved first; the result is a new draft version marked as machine-translated, for a person to check.
   */
  protected async machineTranslate(): Promise<void> {
    const to = this.form.locale();
    const type = this.contentType();
    if (!to || !type || !this.canMachineTranslate() || this.busy()) return;
    if (this.dirty() && !this.checkFor('draft')) return;
    this.cancelAutosave();
    await this.run('saving', async () => {
      if (this.dirty()) {
        const data = this.data();
        this.afterSave(await firstValueFrom(this.api.saveEntry(this.spaceId(), this.entryId(), data)), data);
      }
      const result = await firstValueFrom(this.api.translate(this.spaceId(), this.entryId(), { to }));
      this.entry.set(result.entry);
      this.data.set(result.entry.data);
      this.afterSave(result.entry, result.entry.data);
      const describe = (path: string) => describePath(path, type.fields, result.entry.data, this.blockTypes(), (code) => this.form.localeName(code));
      this.machineTranslated.set(result.translated.length ? { locale: to, fields: result.translated.map(describe) } : null);
      this.status.set(
        result.translated.length
          ? `Machine translation saved as a draft (${result.provider}). Check every translated field before publishing.`
          : `Nothing to translate: every field already has a ${this.form.localeName(to)} translation.`,
      );
      this.focus('entry-status');
    });
  }

  protected workflowChanged(entry: Entry): void {
    this.entry.set(entry);
  }

  protected workflowDone(message: string): void {
    this.problem.set(null);
    this.status.set(message);
    this.focus('entry-status');
  }

  /** From the checklist: the block's controls in the form. */
  protected goToBlock(uid: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(`[id$="-edit-${uid}"]`)?.focus();
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
      const [entry, types, blocks, entries, folders, locales] = await Promise.all([
        firstValueFrom(this.api.getEntry(spaceId, entryId)),
        firstValueFrom(this.api.listContentTypes(spaceId)),
        firstValueFrom(this.api.listBlockTypes(spaceId)),
        firstValueFrom(this.api.listEntries(spaceId)),
        firstValueFrom(this.api.listFolders(spaceId)),
        this.spaceLocales.load(spaceId),
      ]);
      this.form.locales.set(locales.locales);
      const asked = untracked(() => this.locale());
      this.form.locale.set(locales.locales.some((locale) => locale.code === asked && !locale.isDefault) ? (asked as string) : null);
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

/** The `_uid` of the innermost block on a dotted data path (`body.0.children.1.heading`), or null. */
function blockUidAt(data: EntryData, path: string): string | null {
  let value: unknown = data;
  let uid: string | null = null;
  for (const part of path.split('.')) {
    value = Array.isArray(value) ? value[Number(part)] : typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[part] : undefined;
    const found = typeof value === 'object' && value !== null ? (value as { _uid?: unknown })._uid : undefined;
    if (typeof found === 'string') uid = found;
  }
  return uid;
}

/** A media item's place in words (`Content › Hero block › Background image`), and its block. */
function describeMediaPath(
  path: string,
  fields: readonly FieldDef[],
  data: EntryData,
  blockTypes: readonly BlockType[],
  localeName: (code: string) => string,
): { label: string; uid: string | null } {
  const blocks = new Map<string, BlockNode>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (typeof value === 'object' && value !== null) {
      const node = value as Partial<BlockNode>;
      if (typeof node._uid === 'string' && typeof node._block === 'string') blocks.set(node._uid, node as BlockNode);
      Object.values(value).forEach(walk);
    }
  };
  walk(data);
  let available: readonly FieldDef[] | undefined = fields;
  let uid: string | null = null;
  const labels = path.split('.').map((part) => {
    const node = blocks.get(part);
    if (node) {
      uid = part;
      const type = blockTypes.find((t) => t.apiId === node._block);
      available = type?.fields;
      return `${type?.name ?? node._block} block`;
    }
    const field = available?.find((f) => f.apiId === part);
    if (!field && LOCALE_CODE_PATTERN.test(part)) return localeName(part);
    available = field?.type === 'group' ? field.fields : undefined;
    return field?.label ?? (/^\d+$/.test(part) ? `Item ${Number(part) + 1}` : part);
  });
  return { label: labels.join(' › '), uid };
}
