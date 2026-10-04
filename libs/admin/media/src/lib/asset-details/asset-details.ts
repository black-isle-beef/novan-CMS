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
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  DsAlertComponent,
  DsBadgeComponent,
  DsModalComponent,
  DsOffcanvasComponent,
  DsSpinnerComponent,
} from '@black-isle-beef/novan-design-system';
import { AuthService } from '@novan/admin-auth';
import { problemFieldErrors, problemMessage, SpaceContext } from '@novan/admin-spaces';
import { type AssetDetail, type FocalPoint, formatBytes, updateAssetRequestSchema } from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { AssetThumb } from '../asset-thumb/asset-thumb';
import { FocalPointPicker } from '../focal-point-picker/focal-point-picker';
import { MediaApi } from '../media-api';
import { Thumbnails } from '../thumbnails';

interface Draft {
  title: string;
  alt: string;
  tags: string;
  folder: string;
  focal: FocalPoint | null;
}

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** "news, team photos" to a tidy tag list. */
const parseTags = (text: string): string[] =>
  text
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

/**
 * The drawer for one library file: preview, alt text, title, tags, folder and focal point, where it is
 * used, replacing the file (same id) and the bin. Authors may describe only their own uploads; editors
 * describe every file, replace files and use the bin. The API applies the same rules.
 */
@Component({
  selector: 'nv-asset-details',
  imports: [
    AssetThumb,
    DsAlertComponent,
    DsBadgeComponent,
    DsModalComponent,
    DsOffcanvasComponent,
    DsSpinnerComponent,
    FocalPointPicker,
    RouterLink,
  ],
  templateUrl: './asset-details.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetDetails {
  private readonly api = inject(MediaApi);
  private readonly thumbnails = inject(Thumbnails);
  private readonly auth = inject(AuthService);
  private readonly context = inject(SpaceContext);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly spaceId = input.required<string>();
  /** The file shown; null closes the drawer. */
  readonly assetId = model<string | null>(null);
  /** The library's folders, offered when moving the file. */
  readonly folders = input<string[]>([]);
  /** The file changed (described, replaced, binned or restored). */
  readonly changed = output<AssetDetail>();

  protected readonly asset = signal<AssetDetail | null>(null);
  protected readonly url = signal<string | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly draft = signal<Draft | null>(null);
  protected readonly saving = signal(false);
  protected readonly status = signal<string | null>(null);
  protected readonly problem = signal<string | null>(null);
  protected readonly fieldErrors = signal<Record<string, string[]>>({});
  protected readonly confirmingDelete = signal(false);
  protected readonly replacing = signal<number | null>(null);

  protected readonly open = computed(() => this.assetId() !== null);
  protected readonly canEditAny = computed(() => this.context.canPublishCurrent());
  /** Editors describe every file; authors only the ones they uploaded. */
  protected readonly canDescribe = computed(() => {
    const asset = this.asset();
    if (!asset || asset.deletedAt) return false;
    return this.canEditAny() || (this.context.canEditCurrent() && asset.uploadedBy === this.auth.session()?.user.id);
  });
  protected readonly dirty = computed(() => {
    const asset = this.asset();
    const draft = this.draft();
    return Boolean(asset && draft && JSON.stringify(draftOf(asset)) !== JSON.stringify(draft));
  });

  protected readonly formatBytes = formatBytes;

  constructor() {
    effect(() => {
      const id = this.assetId();
      untracked(() => {
        this.reset();
        if (id) void this.load(id);
      });
    });
  }

  protected time(iso: string): string {
    return when.format(new Date(iso));
  }

  protected set(key: keyof Omit<Draft, 'focal'>, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.draft.update((draft) => (draft ? { ...draft, [key]: value } : draft));
    this.fieldErrors.set({});
    this.status.set(null);
  }

  protected setFocal(focal: FocalPoint | null): void {
    this.draft.update((draft) => (draft ? { ...draft, focal } : draft));
    this.status.set(null);
  }

  protected async save(): Promise<void> {
    const asset = this.asset();
    const draft = this.draft();
    if (!asset || !draft || this.saving()) return;
    const body = {
      title: draft.title,
      alt: draft.alt,
      tags: parseTags(draft.tags),
      folder: draft.folder.trim() || null,
      ...(asset.kind === 'image' ? { focal: draft.focal } : {}),
    };
    const checked = updateAssetRequestSchema.safeParse(body);
    if (!checked.success) {
      this.fieldErrors.set(errorsOf(checked.error.issues));
      this.focus(`asset-${Object.keys(errorsOf(checked.error.issues))[0] ?? 'title'}`);
      return;
    }
    await this.run(async () => {
      this.adopt(await firstValueFrom(this.api.update(this.spaceId(), asset.id, checked.data)));
      this.status.set('Details saved.');
      this.focus('asset-status');
    });
  }

  protected async replace(event: Event): Promise<void> {
    const field = event.target as HTMLInputElement;
    const file = field.files?.[0];
    field.value = '';
    const asset = this.asset();
    if (!file || !asset) return;
    await this.run(async () => {
      const target = await firstValueFrom(this.api.replaceUrl(this.spaceId(), asset.id, file));
      this.replacing.set(0);
      await this.api.put(target, file, (progress) => this.replacing.set(progress));
      const replaced = await firstValueFrom(this.api.replace(this.spaceId(), asset.id, target.filename));
      this.adopt(replaced);
      this.url.set((await this.thumbnails.urls(this.spaceId(), [replaced])).get(replaced.id) ?? null);
      this.status.set(`File replaced. Pages using it now show ${replaced.filename}.`);
      this.focus('asset-status');
    });
    this.replacing.set(null);
  }

  protected async remove(): Promise<void> {
    this.confirmingDelete.set(false);
    const asset = this.asset();
    if (!asset) return;
    await this.run(async () => {
      await firstValueFrom(this.api.remove(this.spaceId(), asset.id));
      this.adopt({ ...asset, deletedAt: new Date().toISOString() });
      this.status.set('Moved to the bin. It stays there for 30 days.');
      this.focus('asset-status');
    });
  }

  protected async restore(): Promise<void> {
    const asset = this.asset();
    if (!asset) return;
    await this.run(async () => {
      this.adopt(await firstValueFrom(this.api.restore(this.spaceId(), asset.id)));
      this.status.set('Restored to the library.');
      this.focus('asset-status');
    });
  }

  protected errors(key: string): string[] {
    return this.fieldErrors()[key] ?? [];
  }

  /** The hint (if the field has one) and, while there is one, the error that describe a field. */
  protected describedBy(key: string, hasHint: boolean): string | null {
    const ids = [...(hasHint ? [`asset-${key}-hint`] : []), ...(this.errors(key).length ? [`asset-${key}-error`] : [])];
    return ids.length ? ids.join(' ') : null;
  }

  private adopt(asset: AssetDetail): void {
    this.asset.set(asset);
    this.draft.set(draftOf(asset));
    this.changed.emit(asset);
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.saving.set(true);
    this.status.set(null);
    this.problem.set(null);
    try {
      await action();
    } catch (error) {
      const fields = problemFieldErrors(error);
      if (Object.keys(fields).length) this.fieldErrors.set(fields);
      this.problem.set(problemMessage(error));
      this.focus('asset-problem');
    } finally {
      this.saving.set(false);
    }
  }

  private reset(): void {
    this.asset.set(null);
    this.draft.set(null);
    this.url.set(null);
    this.loadError.set(null);
    this.status.set(null);
    this.problem.set(null);
    this.fieldErrors.set({});
    this.confirmingDelete.set(false);
  }

  private async load(id: string): Promise<void> {
    try {
      const asset = await firstValueFrom(this.api.get(this.spaceId(), id));
      if (this.assetId() !== id) return;
      this.asset.set(asset);
      this.draft.set(draftOf(asset));
      this.url.set((await this.thumbnails.urls(this.spaceId(), [asset])).get(asset.id) ?? null);
    } catch (error) {
      this.loadError.set(problemMessage(error));
    }
  }

  private focus(elementId: string): void {
    afterNextRender(() => this.host.nativeElement.ownerDocument.getElementById(elementId)?.focus(), {
      injector: this.injector,
    });
  }
}

function draftOf(asset: AssetDetail): Draft {
  return {
    title: asset.title ?? '',
    alt: asset.alt ?? '',
    tags: asset.tags.join(', '),
    folder: asset.folder ?? '',
    focal: asset.focal,
  };
}

function errorsOf(issues: readonly { path: PropertyKey[]; message: string }[]): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) (errors[String(issue.path[0] ?? 'title')] ??= []).push(issue.message);
  return errors;
}
