import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  DsAlertComponent,
  DsBadgeComponent,
  DsModalComponent,
  DsSpinnerComponent,
} from '@black-isle-beef/novan-design-system';
import { problemMessage, SpaceContext } from '@novan/admin-spaces';
import type { Asset, AssetDetail } from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { AssetThumb } from '../asset-thumb/asset-thumb';
import { MediaApi } from '../media-api';
import { MediaPicker } from '../media-picker';
import { Thumbnails } from '../thumbnails';
import { MediaUploader } from '../uploader/uploader';

const kindNames = { image: 'an image', video: 'a video', file: 'a file' } as const;
const pluralNames = { image: 'images', video: 'videos', file: 'files' } as const;

/**
 * The dialog media fields open to choose files: the space's library, filtered to the kinds the field
 * takes, with search and upload. Place one on a page that provides {@link MediaPicker}.
 */
@Component({
  selector: 'nv-media-picker',
  imports: [AssetThumb, DsAlertComponent, DsBadgeComponent, DsModalComponent, DsSpinnerComponent, MediaUploader],
  templateUrl: './media-picker-dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MediaPickerDialog {
  private readonly api = inject(MediaApi);
  private readonly thumbnails = inject(Thumbnails);
  private readonly context = inject(SpaceContext);
  protected readonly picker = inject(MediaPicker);

  protected readonly request = this.picker.request;
  protected readonly assets = signal<Asset[] | null>(null);
  protected readonly urls = signal<ReadonlyMap<string, string>>(new Map());
  protected readonly error = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly selected = signal<string[]>([]);
  protected readonly canUpload = computed(() => this.context.canEditCurrent());
  /** Chosen (or cancelled) and waiting for the modal to finish closing. */
  protected readonly closing = signal(false);
  private pending: Asset[] | null = null;

  protected readonly heading = computed(() => {
    const request = this.request();
    if (!request) return '';
    const names = request.accept.map((kind) => (request.multiple ? pluralNames[kind] : kindNames[kind]));
    return `Choose ${names.join(' or ')} for ${request.label}`;
  });

  protected readonly shown = computed(() => {
    const term = this.search().trim().toLowerCase();
    const accept = this.request()?.accept ?? [];
    return (this.assets() ?? []).filter(
      (asset) =>
        accept.includes(asset.kind) &&
        (!term ||
          [asset.title, asset.filename, asset.alt, ...asset.tags].some((text) => text?.toLowerCase().includes(term))),
    );
  });

  constructor() {
    effect(() => {
      const request = this.request();
      untracked(() => {
        this.search.set('');
        this.selected.set([]);
        if (request) void this.load(request.spaceId);
      });
    });
  }

  protected isSelected(asset: Asset): boolean {
    return this.selected().includes(asset.id);
  }

  protected toggle(asset: Asset): void {
    const multiple = this.request()?.multiple ?? false;
    this.selected.update((ids) =>
      ids.includes(asset.id) ? ids.filter((id) => id !== asset.id) : multiple ? [...ids, asset.id] : [asset.id],
    );
  }

  protected setSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected async uploaded(asset: AssetDetail): Promise<void> {
    const request = this.request();
    if (!request) return;
    await this.load(request.spaceId);
    if (request.accept.includes(asset.kind)) this.toggle(asset);
  }

  protected choose(): void {
    const byId = new Map((this.assets() ?? []).map((asset) => [asset.id, asset]));
    this.close(this.selected().flatMap((id) => byId.get(id) ?? []));
  }

  protected cancel(): void {
    // The modal also reports `openChange(false)` while closing after a choice; keep that choice.
    if (!this.closing()) this.close(null);
  }

  /**
   * Hands the choice back once the modal has fully closed: it puts focus back where it was first, and
   * only then can the field move focus to the control that replaced the one that opened the picker.
   */
  protected closed(): void {
    if (!this.request()) return;
    const choice = this.pending;
    this.pending = null;
    this.closing.set(false);
    void this.picker.finish(choice);
  }

  private close(choice: Asset[] | null): void {
    this.pending = choice;
    this.closing.set(true);
  }

  private async load(spaceId: string): Promise<void> {
    this.error.set(null);
    try {
      const assets = await firstValueFrom(this.api.list(spaceId));
      this.assets.set(assets);
      this.urls.set(await this.thumbnails.urls(spaceId, assets));
    } catch (error) {
      this.error.set(problemMessage(error));
    }
  }
}
