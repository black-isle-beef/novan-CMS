import { inject, Injectable, signal } from '@angular/core';
import type { FieldFormContext, MediaPreview, MediaSource } from '@novan/admin-fields';
import type { Asset, AssetKind } from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { MediaApi } from './media-api';
import { Thumbnails } from './thumbnails';

/** What the open picker was asked for. */
export interface PickRequest {
  spaceId: string;
  accept: readonly AssetKind[];
  multiple: boolean;
  /** The field the files are for, for the dialog's heading. */
  label: string;
}

/**
 * The media library for one form: implements the fields' `MediaSource` by loading previews into the
 * form's `FieldFormContext` and opening `<nv-media-picker>` to choose files. Provide it on the page that
 * hosts the form and the picker, then `connect` it to the form.
 */
@Injectable()
export class MediaPicker implements MediaSource {
  private readonly api = inject(MediaApi);
  private readonly thumbnails = inject(Thumbnails);

  /** The open request, shown by `<nv-media-picker>`; null while closed. */
  readonly request = signal<PickRequest | null>(null);

  private form: FieldFormContext | null = null;
  private spaceId: string | null = null;
  private resolve: ((choice: MediaPreview[] | null) => void) | null = null;
  private readonly loading = new Set<string>();

  connect(form: FieldFormContext, spaceId: string): void {
    this.form = form;
    this.spaceId = spaceId;
    form.media.set(this);
  }

  choose(options: { accept: readonly AssetKind[]; multiple: boolean; label: string }): Promise<MediaPreview[] | null> {
    const spaceId = this.spaceId;
    if (!spaceId) return Promise.resolve(null);
    this.resolve?.(null);
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.request.set({ spaceId, ...options });
    });
  }

  /** Called by the picker: the chosen files, or null when cancelled. */
  async finish(chosen: Asset[] | null): Promise<void> {
    const resolve = this.resolve;
    const spaceId = this.request()?.spaceId;
    this.resolve = null;
    this.request.set(null);
    if (!chosen?.length || !spaceId) {
      resolve?.(null);
      return;
    }
    const previews = await this.previews(spaceId, chosen);
    this.store(new Map(previews.map((preview) => [preview.id, preview])));
    resolve?.(previews);
  }

  load(ids: readonly string[]): void {
    const spaceId = this.spaceId;
    const wanted = ids.filter((id) => !this.loading.has(id));
    if (!spaceId || !wanted.length) return;
    wanted.forEach((id) => this.loading.add(id));
    void (async () => {
      try {
        const found = await firstValueFrom(this.api.list(spaceId, { ids: wanted.join(',') }));
        const previews = new Map((await this.previews(spaceId, found)).map((preview) => [preview.id, preview]));
        // Files not found are in the bin or gone.
        this.store(new Map(wanted.map((id) => [id, previews.get(id) ?? null])));
      } catch {
        // Leave them loading-free so a later render can try again; the API still validates on save.
      } finally {
        wanted.forEach((id) => this.loading.delete(id));
      }
    })();
  }

  private async previews(spaceId: string, assets: readonly Asset[]): Promise<MediaPreview[]> {
    const urls = await this.thumbnails.urls(
      spaceId,
      assets.filter((asset) => asset.kind === 'image'),
    );
    return assets.map((asset) => ({
      id: asset.id,
      filename: asset.filename,
      title: asset.title,
      kind: asset.kind,
      alt: asset.alt,
      thumbnailUrl: urls.get(asset.id) ?? null,
    }));
  }

  private store(previews: ReadonlyMap<string, MediaPreview | null>): void {
    this.form?.assets.update((assets) => new Map([...assets, ...previews]));
  }
}
