import { HttpErrorResponse } from '@angular/common/http';
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
import {
  DsAlertComponent,
  DsButtonComponent,
  DsModalComponent,
  DsSpinnerComponent,
} from '@black-isle-beef/novan-design-system';
import { Shortcuts, shortcutKeys } from '@novan/admin-shell';
import { problemCode, problemFieldErrors, problemMessage, SpaceContext } from '@novan/admin-spaces';
import {
  type BlockType,
  type ContentType,
  type ContentTypeKind,
  createBlockTypeRequestSchema,
  createContentTypeRequestSchema,
  type FieldDef,
  updateBlockTypeRequestSchema,
  updateContentTypeRequestSchema,
} from '@novan/shared-schemas';
import { firstValueFrom, type Observable } from 'rxjs';
import type { z } from 'zod';
import { FieldList } from '../field-list/field-list';
import { type ModelOptions, noModelOptions, toApiId } from '../field-types';
import { describeIssue, issuesFromErrors } from '../issue-text';
import { type ModelKind, SchemaApi } from '../schema-api';

interface KindOption {
  value: ContentTypeKind;
  label: string;
  description: string;
}

const kindOptions: KindOption[] = [
  { value: 'page', label: 'Page', description: 'Has its own web address and is built from blocks.' },
  { value: 'entry', label: 'Entry', description: 'Reusable content, such as an author or a product.' },
  { value: 'singleton', label: 'Singleton', description: 'Exactly one, such as site settings or navigation.' },
];

/** What a failed save or delete asks of the developer. */
interface Blocked {
  message: string;
  /** Entries the change would invalidate: offer to apply it anyway. */
  affectedEntries: number | null;
  action: 'save' | 'delete';
}

/** Creates or edits a content type or a block type: details, fields and (for blocks) style options. */
@Component({
  selector: 'nv-type-editor-page',
  imports: [DsAlertComponent, DsButtonComponent, DsModalComponent, DsSpinnerComponent, FieldList, RouterLink],
  templateUrl: './type-editor-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TypeEditorPage {
  private readonly api = inject(SchemaApi);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly context = inject(SpaceContext);

  /** Route parameters, data and query (component input binding). */
  readonly spaceId = input.required<string>();
  readonly apiId = input<string>();
  readonly kind = input.required<ModelKind>();
  readonly created = input<string>();

  protected readonly kindOptions = kindOptions;
  protected readonly isBlock = computed(() => this.kind() === 'block-types');
  protected readonly isNew = computed(() => !this.apiId());
  protected readonly noun = computed(() => (this.isBlock() ? 'block type' : 'content type'));
  protected readonly title = computed(() =>
    this.isNew() ? `New ${this.noun()}` : (this.existing()?.name ?? this.apiId() ?? ''),
  );

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly existing = signal<ContentType | BlockType | null>(null);
  protected readonly options = signal<ModelOptions>(noModelOptions);

  protected readonly name = signal('');
  protected readonly newApiId = signal('');
  private apiIdEdited = false;
  protected readonly contentKind = signal<ContentTypeKind>('page');
  protected readonly description = signal('');
  protected readonly icon = signal('');
  protected readonly allowedChildren = signal<string[]>([]);
  protected readonly styleOptionsText = signal('{}');
  protected readonly fields = signal<FieldDef[]>([]);

  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly status = signal<string | null>(null);
  protected readonly blocked = signal<Blocked | null>(null);
  protected readonly serverIssues = signal<string[]>([]);
  protected readonly confirmingDelete = signal(false);

  private readonly styleOptions = computed<{ value: unknown; error: string | null }>(() => {
    try {
      return { value: JSON.parse(this.styleOptionsText() || '{}'), error: null };
    } catch {
      return { value: {}, error: 'Style options: this is not valid JSON.' };
    }
  });

  /** The request body exactly as it will be sent, also shown as the live JSON preview. */
  protected readonly body = computed<Record<string, unknown>>(() => {
    const common = { name: this.name().trim(), fields: this.fields() };
    if (this.isBlock()) {
      return {
        ...(this.isNew() ? { apiId: this.newApiId() } : {}),
        ...common,
        icon: this.icon().trim() || null,
        allowedChildren: this.allowedChildren(),
        styleOptions: this.styleOptions().value,
      };
    }
    return {
      ...(this.isNew() ? { apiId: this.newApiId(), kind: this.contentKind() } : {}),
      ...common,
      description: this.description().trim() || null,
    };
  });
  protected readonly json = computed(() => JSON.stringify(this.body(), null, 2));

  /** Problems found by the same Zod schemas the API validates with. */
  protected readonly issues = computed<string[]>(() => {
    const schema: z.ZodType = this.isBlock()
      ? this.isNew()
        ? createBlockTypeRequestSchema
        : updateBlockTypeRequestSchema
      : this.isNew()
        ? createContentTypeRequestSchema
        : updateContentTypeRequestSchema;
    const result = schema.safeParse(this.body());
    const issues = result.success ? [] : result.error.issues.map((issue) => describeIssue(issue, this.fields()));
    const jsonError = this.isBlock() ? this.styleOptions().error : null;
    return jsonError ? [jsonError, ...issues] : issues;
  });

  protected readonly blockChoices = computed(() => {
    const own = this.isNew() ? this.newApiId() : this.apiId();
    const others = this.options().blockTypes.filter((type) => type.apiId !== own);
    // A block may contain blocks of its own type (for example nested columns).
    return own ? [...others, { apiId: own, name: `${this.name() || own} (this block)` }] : others;
  });

  protected readonly shortcutKeys = shortcutKeys;

  constructor() {
    inject(Shortcuts).register('save', () => void this.save());
    effect(() => {
      const spaceId = this.spaceId();
      const kind = this.kind();
      const apiId = this.apiId();
      untracked(() => {
        this.context.currentSpaceId.set(spaceId);
        void this.load(spaceId, kind, apiId);
      });
    });
  }

  protected setName(event: Event): void {
    this.name.set(valueOf(event));
    if (this.isNew() && !this.apiIdEdited) this.newApiId.set(toApiId(this.name()));
  }

  protected setApiId(event: Event): void {
    this.apiIdEdited = true;
    this.newApiId.set(valueOf(event).trim());
  }

  protected setText(target: { set(value: string): void }, event: Event): void {
    target.set(valueOf(event));
  }

  protected setKind(kind: ContentTypeKind): void {
    this.contentKind.set(kind);
  }

  protected toggleChild(apiId: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.allowedChildren.update((list) => (checked ? [...list, apiId] : list.filter((child) => child !== apiId)));
  }

  protected async save(force = false): Promise<void> {
    this.submitted.set(true);
    this.status.set(null);
    this.blocked.set(null);
    this.serverIssues.set([]);
    if (this.issues().length) {
      this.focus('type-editor-errors');
      return;
    }

    this.saving.set(true);
    try {
      if (this.isNew()) {
        const saved = await firstValueFrom(this.request(this.kind(), 'create'));
        await this.router.navigate(['/spaces', this.spaceId(), 'schema', this.kind(), saved.apiId], {
          queryParams: { created: 1 },
        });
        return;
      }
      const saved = await firstValueFrom(this.request(this.kind(), 'update', force));
      this.fill(saved);
      this.submitted.set(false);
      this.status.set(`Saved ${saved.name}.`);
      this.focus('type-editor-status');
    } catch (error) {
      this.showFailure(error, 'save');
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(force = false): Promise<void> {
    this.confirmingDelete.set(false);
    this.blocked.set(null);
    const apiId = this.apiId();
    if (!apiId) return;
    try {
      const deletion = this.isBlock()
        ? this.api.deleteBlockType(this.spaceId(), apiId, force)
        : this.api.deleteContentType(this.spaceId(), apiId, force);
      await firstValueFrom(deletion);
      await this.router.navigate(['/spaces', this.spaceId(), 'schema'], {
        queryParams: { deleted: this.existing()?.name ?? apiId },
      });
    } catch (error) {
      this.showFailure(error, 'delete');
    }
  }

  protected retry(blocked: Blocked): void {
    void (blocked.action === 'save' ? this.save(true) : this.remove(true));
  }

  private request(kind: ModelKind, mode: 'create' | 'update', force = false): Observable<ContentType | BlockType> {
    const spaceId = this.spaceId();
    const apiId = this.apiId() ?? '';
    const body = this.body();
    // The body has just passed the matching request schema (see `issues`).
    if (kind === 'block-types') {
      return mode === 'create'
        ? this.api.createBlockType(spaceId, body as z.input<typeof createBlockTypeRequestSchema>)
        : this.api.updateBlockType(spaceId, apiId, body as z.input<typeof updateBlockTypeRequestSchema>, force);
    }
    return mode === 'create'
      ? this.api.createContentType(spaceId, body as z.input<typeof createContentTypeRequestSchema>)
      : this.api.updateContentType(spaceId, apiId, body as z.input<typeof updateContentTypeRequestSchema>, force);
  }

  private async load(spaceId: string, kind: ModelKind, apiId: string | undefined): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    this.status.set(this.created() ? `Created. You can keep adding fields.` : null);
    try {
      const [contentTypes, blockTypes] = await Promise.all([
        firstValueFrom(this.api.listContentTypes(spaceId)),
        firstValueFrom(this.api.listBlockTypes(spaceId)),
      ]);
      this.options.set({
        contentTypes: contentTypes.map(({ apiId, name }) => ({ apiId, name })),
        blockTypes: blockTypes.map(({ apiId, name }) => ({ apiId, name })),
      });
      const list: (ContentType | BlockType)[] = kind === 'block-types' ? blockTypes : contentTypes;
      const existing = apiId ? list.find((type) => type.apiId === apiId) : undefined;
      if (apiId && !existing) {
        this.loadError.set(`There is no ${this.noun()} "${apiId}" in this space.`);
        return;
      }
      if (existing) this.fill(existing);
    } catch (error) {
      this.loadError.set(problemMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  private fill(type: ContentType | BlockType): void {
    this.existing.set(type);
    this.name.set(type.name);
    this.fields.set(type.fields);
    if ('kind' in type) {
      this.contentKind.set(type.kind);
      this.description.set(type.description ?? '');
    } else {
      this.icon.set(type.icon ?? '');
      this.allowedChildren.set(type.allowedChildren);
      this.styleOptionsText.set(JSON.stringify(type.styleOptions, null, 2));
    }
  }

  private showFailure(error: unknown, action: Blocked['action']): void {
    const affected =
      problemCode(error) === 'entries_invalidated' && error instanceof HttpErrorResponse
        ? Number((error.error as { affectedEntries?: unknown }).affectedEntries ?? 0)
        : null;
    this.blocked.set({ message: problemMessage(error), affectedEntries: affected, action });
    this.serverIssues.set(issuesFromErrors(problemFieldErrors(error)).map((issue) => describeIssue(issue, this.fields())));
    this.focus('type-editor-blocked');
  }

  private focus(elementId: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(`#${elementId}`)?.focus(), {
      injector: this.injector,
    });
  }
}

const valueOf = (event: Event): string => (event.target as HTMLInputElement | HTMLTextAreaElement).value;
