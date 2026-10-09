import { afterNextRender, computed, Directive, DOCUMENT, effect, inject, Injector, input, signal, untracked } from '@angular/core';
import { ContentApi } from '@novan/admin-content';
import { describePath, errorsFromIssues, FieldFormContext, fieldId } from '@novan/admin-fields';
import { MediaPicker } from '@novan/admin-media';
import { type HasUnsavedChanges, Shortcuts, warnBeforeUnload } from '@novan/admin-shell';
import { problemCode, problemFieldErrors, problemMessage, SpaceContext } from '@novan/admin-spaces';
import { buildEntrySchema, type ContentType, type Entry, type EntryData, type FieldDef, sameJson } from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';

type Check = 'draft' | 'publish';

/**
 * What the site settings and navigation screens share (docs/build/14-seo-site-features.md): each edits one
 * singleton of the space, with the same validation as the API (`buildEntrySchema`), an error summary linking to the
 * fields, Save draft (authors and up) and Publish (editors and up; with approval on, space admins), and a warning
 * before leaving with unsaved changes. The component provides `FieldFormContext` and `MediaPicker`.
 */
@Directive()
export abstract class SingletonEditor implements HasUnsavedChanges {
  protected readonly api = inject(ContentApi);
  protected readonly form = inject(FieldFormContext);
  private readonly media = inject(MediaPicker);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  protected readonly context = inject(SpaceContext);

  /** The singleton's content type api id, e.g. `siteSettings`. */
  protected abstract readonly apiId: string;
  /** Prefix of the ids of the screen's status, problem and error summary. */
  protected abstract readonly idPrefix: string;

  /** Bound from the `:spaceId` route parameter. */
  readonly spaceId = input.required<string>();

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  /** The space has no such singleton (or none published or drafted yet). */
  protected readonly missing = signal(false);
  protected readonly type = signal<ContentType | null>(null);
  protected readonly entry = signal<Entry | null>(null);
  protected readonly data = signal<EntryData>({});
  private readonly saved = signal<EntryData>({});
  protected readonly dirty = computed(() => !sameJson(this.data(), this.saved()));

  protected readonly busy = signal<'saving' | 'publishing' | null>(null);
  protected readonly status = signal<string | null>(null);
  protected readonly problem = signal<string | null>(null);
  private readonly check = signal<Check | null>(null);
  private readonly serverErrors = signal<Record<string, string[]>>({});

  protected readonly canEdit = computed(() => this.context.canEditCurrent());
  protected readonly canPublish = computed(() => this.context.canPublishCurrent());
  /** Whether the site shows what is saved: published, with no changes since. */
  protected readonly live = computed(() => {
    const entry = this.entry();
    return entry !== null && entry.status === 'published' && !entry.hasUnpublishedChanges && !this.dirty();
  });

  private readonly schemas = computed(() => {
    const type = this.type();
    if (!type) return null;
    this.form.assets();
    const assets = (id: string) => this.form.assetInfo(id);
    return {
      draft: buildEntrySchema(type.fields, { draft: true, assets }),
      publish: buildEntrySchema(type.fields, { assets }),
    };
  });

  /** Field errors for the check last asked for, plus those the API reported. */
  protected readonly errors = computed<Record<string, string[]>>(() => {
    const check = this.check();
    const schemas = this.schemas();
    let local: Record<string, string[]> = {};
    if (check && schemas) {
      const result = schemas[check].safeParse(this.data());
      if (!result.success) local = errorsFromIssues(result.error.issues);
    }
    return { ...local, ...this.serverErrors() };
  });

  /** The error summary: each problem, named after its field, linking to it. */
  protected readonly summary = computed(() => {
    const type = this.type();
    return Object.entries(this.errors()).flatMap(([path, messages]) =>
      messages.map((message) => ({ href: `#${this.controlId(path)}`, text: `${this.describe(path, type?.fields ?? [])}: ${message}` })),
    );
  });

  constructor() {
    effect(() => {
      const spaceId = this.spaceId();
      untracked(() => {
        this.context.currentSpaceId.set(spaceId);
        this.media.connect(this.form, spaceId);
        void this.load(spaceId);
      });
    });
    effect(() => this.form.errors.set(this.errors()));
    effect(() => this.form.readonly.set(!this.canEdit()));
    inject(Shortcuts).register('save', () => void this.save());
    warnBeforeUnload(() => this.hasUnsavedChanges());
  }

  hasUnsavedChanges(): boolean {
    return this.canEdit() && this.dirty() && this.busy() === null;
  }

  protected setData(data: EntryData): void {
    this.data.set(data);
    this.serverErrors.set({});
    this.status.set(null);
  }

  /** The DOM id of the control for a data path; the error summary links to it. */
  protected controlId(path: string): string {
    return fieldId(path);
  }

  /** A readable name for a data path, for the error summary. */
  protected describe(path: string, fields: readonly FieldDef[]): string {
    return describePath(path, fields, this.data(), []);
  }

  protected async save(): Promise<void> {
    const entry = this.entry();
    if (!entry || !this.canEdit() || this.busy() || !this.passes('draft')) return;
    const data = this.data();
    await this.run('saving', async () => {
      this.afterSave(await firstValueFrom(this.api.saveEntry(this.spaceId(), entry.id, data)), data);
      this.status.set('Saved as a draft. Publish to show it on the site.');
    });
  }

  /** Saves the changes, if there are some, and puts them on the site. */
  protected async publish(): Promise<void> {
    const entry = this.entry();
    if (!entry || !this.canPublish() || this.busy() || !this.passes('publish')) return;
    const data = this.data();
    await this.run('publishing', async () => {
      if (this.dirty()) this.afterSave(await firstValueFrom(this.api.saveEntry(this.spaceId(), entry.id, data)), data);
      this.entry.set(await firstValueFrom(this.api.publish(this.spaceId(), entry.id)));
      this.status.set('Published. The site shows the changes now.');
    });
  }

  private async load(spaceId: string): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    this.missing.set(false);
    try {
      const [types, found, entries] = await Promise.all([
        firstValueFrom(this.api.listContentTypes(spaceId)),
        firstValueFrom(this.api.listEntries(spaceId, { contentType: this.apiId })),
        firstValueFrom(this.api.listEntries(spaceId)),
      ]);
      const type = types.find((candidate) => candidate.apiId === this.apiId) ?? null;
      if (!type || !found.length) {
        this.missing.set(true);
        return;
      }
      const entry = await firstValueFrom(this.api.getEntry(spaceId, found[0].id));
      this.type.set(type);
      // Internal links choose from the site's pages.
      this.form.entries.set(entries.filter((e) => e.kind === 'page').map(({ id, title, contentType, path }) => ({ id, title, contentType, path })));
      this.entry.set(entry);
      this.data.set(entry.data);
      this.saved.set(entry.data);
    } catch (error) {
      this.loadError.set(problemMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  /** Runs the local check; on failure the error summary is shown and focused. */
  private passes(check: Check): boolean {
    this.status.set(null);
    this.problem.set(null);
    this.serverErrors.set({});
    this.check.set(check);
    if (!this.summary().length) return true;
    this.focus(`${this.idPrefix}-errors`);
    return false;
  }

  private async run(busy: 'saving' | 'publishing', action: () => Promise<void>): Promise<void> {
    this.busy.set(busy);
    try {
      await action();
      this.check.set(null);
    } catch (error) {
      const fields = problemFieldErrors(error);
      if (problemCode(error) === 'entry_invalid' && Object.keys(fields).length) {
        this.serverErrors.set(fields);
        this.focus(`${this.idPrefix}-errors`);
      } else {
        this.problem.set(problemMessage(error));
        this.focus(`${this.idPrefix}-problem`);
      }
    } finally {
      this.busy.set(null);
    }
  }

  private afterSave(entry: Entry, data: EntryData): void {
    this.entry.set(entry);
    this.saved.set(data);
  }


  protected focus(id: string): void {
    afterNextRender(() => this.document.getElementById(id)?.focus(), { injector: this.injector });
  }
}
