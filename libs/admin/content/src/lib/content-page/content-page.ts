import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
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
import { copy, Skeleton } from '@novan/admin-shell';
import { problemFieldErrors, problemMessage, SpaceContext, SpaceLocales } from '@novan/admin-spaces';
import { type ContentType, type EntrySummary, type Folder, slugify, slugSchema } from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { ContentApi } from '../content-api';
import { buildTree, searchEntries, statusBadges } from '../content-tree';
import { PageTree } from '../page-tree/page-tree';

/** The folder dialog: a new folder (no `folder`), or renaming one. */
interface FolderDialog {
  folder: Folder | null;
  name: string;
  slug: string;
  parentId: string | null;
  slugEdited: boolean;
}

/** Pages and other content of a space as a folder tree, with search, new page and folder dialogs, and the bin. */
@Component({
  selector: 'nv-content-page',
  imports: [DsAlertComponent, DsBadgeComponent, DsButtonComponent, DsModalComponent, PageTree, RouterLink, Skeleton],
  templateUrl: './content-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContentPage {
  private readonly api = inject(ContentApi);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly context = inject(SpaceContext);
  private readonly spaceLocales = inject(SpaceLocales);

  /** Bound from the `:spaceId` route parameter. */
  readonly spaceId = input.required<string>();
  /** `?add=page` (from the dashboard and the checklist) opens the New page dialog once the page types are loaded. */
  readonly add = input<string | undefined>();

  protected readonly copy = copy;

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly folders = signal<Folder[]>([]);
  protected readonly entries = signal<EntrySummary[]>([]);
  protected readonly bin = signal<EntrySummary[]>([]);
  protected readonly contentTypes = signal<ContentType[]>([]);
  protected readonly status = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);

  protected readonly search = signal('');
  protected readonly tree = computed(() => buildTree(this.folders(), this.entries()));
  protected readonly results = computed(() => (this.search().trim() ? searchEntries(this.entries(), this.search()) : null));
  protected readonly statusBadges = statusBadges;

  protected readonly canEdit = computed(() => this.context.canEditCurrent());
  protected readonly canPublish = computed(() => this.context.canPublishCurrent());

  // New page dialog.
  protected readonly creating = signal(false);
  protected readonly newType = signal('');
  protected readonly newTitle = signal('');
  protected readonly newSlug = signal('');
  private newSlugEdited = false;
  protected readonly newFolderId = signal<string | null>(null);
  protected readonly newSubmitted = signal(false);
  protected readonly newErrors = signal<Record<string, string[]>>({});
  protected readonly newIssues = computed(() => {
    const errors: Record<string, string[]> = {};
    if (!this.newTitle().trim()) errors['title'] = ['Enter a title.'];
    const slug = slugSchema.safeParse(this.newSlug());
    if (!slug.success) errors['slug'] = slug.error.issues.map((issue) => issue.message);
    return { ...errors, ...this.newErrors() };
  });

  // Folder dialog.
  protected readonly folderDialog = signal<FolderDialog | null>(null);
  protected readonly folderSubmitted = signal(false);
  protected readonly folderServerErrors = signal<Record<string, string[]>>({});
  protected readonly folderIssues = computed(() => {
    const dialog = this.folderDialog();
    if (!dialog) return {};
    const errors: Record<string, string[]> = {};
    if (!dialog.name.trim()) errors['name'] = ['Enter a name.'];
    const slug = slugSchema.safeParse(dialog.slug);
    if (!slug.success) errors['slug'] = slug.error.issues.map((issue) => issue.message);
    return { ...errors, ...this.folderServerErrors() };
  });
  protected readonly deletingFolder = signal<Folder | null>(null);

  constructor() {
    effect(() => {
      const spaceId = this.spaceId();
      untracked(() => {
        this.context.currentSpaceId.set(spaceId);
        void this.load(spaceId).then(() => this.openNewFromLink());
      });
    });
  }

  /** Opens the New page dialog for a `?add=page` link, then drops the parameter so a reload does not reopen it. */
  private openNewFromLink(): void {
    if (this.add() !== 'page' || !this.canEdit() || !this.contentTypes().length) return;
    this.openNew();
    void this.router.navigate([], { queryParams: { add: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  protected setSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  // --- New page ---

  protected openNew(): void {
    const types = this.contentTypes();
    this.newType.set(types.find((type) => type.apiId === 'page')?.apiId ?? types[0]?.apiId ?? '');
    this.newTitle.set('');
    this.newSlug.set('');
    this.newSlugEdited = false;
    this.newFolderId.set(null);
    this.newSubmitted.set(false);
    this.newErrors.set({});
    this.creating.set(true);
  }

  protected setNewTitle(event: Event): void {
    this.newTitle.set(valueOf(event));
    this.newErrors.set({});
    if (!this.newSlugEdited) this.newSlug.set(slugify(this.newTitle()));
  }

  protected setNewSlug(event: Event): void {
    this.newSlugEdited = true;
    this.newErrors.set({});
    this.newSlug.set(valueOf(event).trim());
  }

  protected setNewType(event: Event): void {
    this.newType.set(valueOf(event));
  }

  protected setNewFolder(event: Event): void {
    this.newFolderId.set(valueOf(event) || null);
    this.newErrors.set({});
  }

  protected async create(): Promise<void> {
    this.newSubmitted.set(true);
    if (Object.keys(this.newIssues()).length) {
      this.focus('new-entry-title');
      return;
    }
    const type = this.contentTypes().find((t) => t.apiId === this.newType());
    if (!type) return;
    // Put the title in the type's title (or name) field; the API fills a `slug` field from `slug`.
    const titleField = type.fields.find((field) => field.apiId === 'title' || field.apiId === 'name');
    try {
      const entry = await firstValueFrom(
        this.api.createEntry(this.spaceId(), {
          contentType: type.apiId,
          folderId: this.newFolderId(),
          slug: this.newSlug(),
          data: titleField ? { [titleField.apiId]: this.newTitle().trim() } : {},
        }),
      );
      this.creating.set(false);
      await this.router.navigate(['/spaces', this.spaceId(), 'content', entry.id]);
    } catch (error) {
      const errors = problemFieldErrors(error);
      this.newErrors.set(Object.keys(errors).length ? errors : { slug: [problemMessage(error)] });
      this.focus('new-entry-slug');
    }
  }

  // --- Folders ---

  protected openNewFolder(): void {
    this.folderDialog.set({ folder: null, name: '', slug: '', parentId: null, slugEdited: false });
    this.folderSubmitted.set(false);
    this.folderServerErrors.set({});
  }

  protected openRename(folder: Folder): void {
    this.folderDialog.set({ folder, name: folder.name, slug: folder.slug, parentId: folder.parentId, slugEdited: true });
    this.folderSubmitted.set(false);
    this.folderServerErrors.set({});
  }

  protected setFolderName(event: Event): void {
    const name = valueOf(event);
    this.folderServerErrors.set({});
    this.folderDialog.update((dialog) =>
      dialog ? { ...dialog, name, slug: dialog.slugEdited ? dialog.slug : slugify(name) } : dialog,
    );
  }

  protected setFolderSlug(event: Event): void {
    const slug = valueOf(event).trim();
    this.folderServerErrors.set({});
    this.folderDialog.update((dialog) => (dialog ? { ...dialog, slug, slugEdited: true } : dialog));
  }

  protected setFolderParent(event: Event): void {
    const parentId = valueOf(event) || null;
    this.folderServerErrors.set({});
    this.folderDialog.update((dialog) => (dialog ? { ...dialog, parentId } : dialog));
  }

  /** Folders a folder can go in: not itself or anything inside it. */
  protected parentChoices(dialog: FolderDialog): Folder[] {
    const own = dialog.folder;
    return this.folders().filter((folder) => !own || (folder.id !== own.id && !folder.path.startsWith(`${own.path}/`)));
  }

  protected async saveFolder(): Promise<void> {
    const dialog = this.folderDialog();
    if (!dialog) return;
    this.folderSubmitted.set(true);
    if (Object.keys(this.folderIssues()).length) {
      this.focus('folder-name');
      return;
    }
    const body = { name: dialog.name.trim(), slug: dialog.slug, parentId: dialog.parentId };
    try {
      if (dialog.folder) await firstValueFrom(this.api.updateFolder(this.spaceId(), dialog.folder.id, body));
      else await firstValueFrom(this.api.createFolder(this.spaceId(), body));
      this.folderDialog.set(null);
      this.status.set(dialog.folder ? `Saved the ${body.name} folder.` : `Added the ${body.name} folder.`);
      await this.reload();
    } catch (error) {
      const errors = problemFieldErrors(error);
      this.folderServerErrors.set(Object.keys(errors).length ? errors : { slug: [problemMessage(error)] });
      this.focus('folder-slug');
    }
  }

  protected async deleteFolder(): Promise<void> {
    const folder = this.deletingFolder();
    this.deletingFolder.set(null);
    if (!folder) return;
    await this.act(() => firstValueFrom(this.api.deleteFolder(this.spaceId(), folder.id)), `Deleted the ${folder.name} folder.`);
  }

  // --- Bin ---

  protected async restore(entry: EntrySummary): Promise<void> {
    await this.act(() => firstValueFrom(this.api.restoreEntry(this.spaceId(), entry.id)), `Restored ${entry.title}. It is a draft again.`);
  }

  private async act(action: () => Promise<unknown>, done: string): Promise<void> {
    this.status.set(null);
    this.actionError.set(null);
    try {
      await action();
      this.status.set(done);
      await this.reload();
      this.focus('content-status');
    } catch (error) {
      this.actionError.set(problemMessage(error));
      this.focus('content-error');
    }
  }

  private reload(): Promise<void> {
    return this.load(this.spaceId(), false);
  }

  private async load(spaceId: string, showSpinner = true): Promise<void> {
    if (showSpinner) this.loading.set(true);
    this.loadError.set(null);
    // For the names of languages with translations missing; their codes show until then.
    this.spaceLocales.load(spaceId).catch(() => undefined);
    try {
      const [folders, entries, bin, types] = await Promise.all([
        firstValueFrom(this.api.listFolders(spaceId)),
        firstValueFrom(this.api.listEntries(spaceId)),
        firstValueFrom(this.api.listEntries(spaceId, { deleted: 'true' })),
        firstValueFrom(this.api.listContentTypes(spaceId)),
      ]);
      this.folders.set(folders);
      this.entries.set(entries);
      this.bin.set(bin);
      this.contentTypes.set(types);
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

const valueOf = (event: Event): string => (event.target as HTMLInputElement | HTMLSelectElement).value;
