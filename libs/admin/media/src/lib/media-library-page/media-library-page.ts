import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DsAlertComponent, DsBadgeComponent, DsSpinnerComponent } from '@black-isle-beef/novan-design-system';
import { problemMessage, SpaceContext } from '@novan/admin-spaces';
import { type Asset, type AssetKind, formatBytes } from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { AssetDetails } from '../asset-details/asset-details';
import { AssetThumb } from '../asset-thumb/asset-thumb';
import { MediaApi } from '../media-api';
import { Thumbnails } from '../thumbnails';
import { MediaUploader } from '../uploader/uploader';

/** `all`, `root` (files in no folder), or a folder like `Brand/Logos` (its subfolders included). */
type FolderFilter = string;

interface FolderOption {
  path: string;
  name: string;
  depth: number;
}

const kindLabels: Record<AssetKind, string> = { image: 'Image', video: 'Video', file: 'Document' };
const added = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/**
 * The media library of a space: upload (drag and drop, several at once, with progress), browse by folder,
 * type and tag, search, grid or list, the detail drawer and the bin.
 */
@Component({
  selector: 'nv-media-library-page',
  imports: [AssetDetails, AssetThumb, DsAlertComponent, DsBadgeComponent, DsSpinnerComponent, MediaUploader],
  templateUrl: './media-library-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MediaLibraryPage {
  private readonly api = inject(MediaApi);
  private readonly thumbnails = inject(Thumbnails);
  protected readonly context = inject(SpaceContext);

  /** Bound from the `:spaceId` route parameter. */
  readonly spaceId = input.required<string>();

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly assets = signal<Asset[]>([]);
  protected readonly bin = signal<Asset[]>([]);
  protected readonly urls = signal<ReadonlyMap<string, string>>(new Map());

  protected readonly search = signal('');
  protected readonly kind = signal<AssetKind | ''>('');
  protected readonly tag = signal('');
  protected readonly folder = signal<FolderFilter>('all');
  protected readonly view = signal<'grid' | 'list'>('grid');
  protected readonly openId = signal<string | null>(null);

  protected readonly canUpload = computed(() => this.context.canEditCurrent());
  protected readonly canEditAny = computed(() => this.context.canPublishCurrent());
  protected readonly kindLabels = kindLabels;
  protected readonly formatBytes = formatBytes;

  /** Every folder in use, with the folders above them, as an indented list. */
  protected readonly folders = computed<FolderOption[]>(() => {
    const paths = new Set<string>();
    for (const asset of this.assets()) {
      if (!asset.folder) continue;
      const parts = asset.folder.split('/');
      parts.forEach((_, index) => paths.add(parts.slice(0, index + 1).join('/')));
    }
    return [...paths]
      .sort((a, b) => a.localeCompare(b))
      .map((path) => ({ path, name: path.split('/').pop() ?? path, depth: path.split('/').length - 1 }));
  });
  protected readonly folderPaths = computed(() => this.folders().map((folder) => folder.path));

  protected readonly tags = computed(() => [...new Set(this.assets().flatMap((asset) => asset.tags))].sort());

  protected readonly shown = computed(() => {
    const term = this.search().trim().toLowerCase();
    const folder = this.folder();
    return this.assets().filter(
      (asset) =>
        (folder === 'all' ||
          (folder === 'root' ? !asset.folder : asset.folder === folder || asset.folder?.startsWith(`${folder}/`))) &&
        (!this.kind() || asset.kind === this.kind()) &&
        (!this.tag() || asset.tags.includes(this.tag())) &&
        (!term ||
          [asset.title, asset.filename, asset.alt, ...asset.tags].some((text) => text?.toLowerCase().includes(term))),
    );
  });

  /** Where new uploads go: the folder being viewed, if it is one. */
  protected readonly uploadFolder = computed(() =>
    this.folder() === 'all' || this.folder() === 'root' ? null : this.folder(),
  );

  protected readonly folderName = computed(() => {
    const folder = this.folder();
    if (folder === 'all') return 'All files';
    if (folder === 'root') return 'Not in a folder';
    return folder.split('/').join(' / ');
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

  protected depthClass(depth: number): string {
    return `ps-${Math.min(5, depth * 2 + 2)}`;
  }

  protected date(iso: string): string {
    return added.format(new Date(iso));
  }

  protected setSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected setKind(event: Event): void {
    this.kind.set((event.target as HTMLSelectElement).value as AssetKind | '');
  }

  protected setTag(event: Event): void {
    this.tag.set((event.target as HTMLSelectElement).value);
  }

  protected reload(): Promise<void> {
    return this.load(this.spaceId(), false);
  }

  private async load(spaceId: string, showSpinner = true): Promise<void> {
    if (showSpinner) this.loading.set(true);
    this.loadError.set(null);
    try {
      const [assets, bin] = await Promise.all([
        firstValueFrom(this.api.list(spaceId)),
        firstValueFrom(this.api.list(spaceId, { deleted: 'true' })),
      ]);
      this.assets.set(assets);
      this.bin.set(bin);
      this.urls.set(await this.thumbnails.urls(spaceId, [...assets, ...bin]));
    } catch (error) {
      this.loadError.set(problemMessage(error));
    } finally {
      this.loading.set(false);
    }
  }
}
