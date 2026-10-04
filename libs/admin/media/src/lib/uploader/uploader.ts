import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { DsProgressComponent } from '@black-isle-beef/novan-design-system';
import { problemMessage } from '@novan/admin-spaces';
import { type AssetDetail, type AssetKind, acceptedFileTypes, formatBytes, uploadLimit } from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { MediaApi } from '../media-api';

type UploadState = 'uploading' | 'checking' | 'done' | 'failed';

interface Upload {
  key: number;
  name: string;
  progress: number;
  state: UploadState;
  message: string | null;
}

/** How many files go up at once. */
const PARALLEL = 3;

let nextId = 0;

/**
 * Drag-and-drop (or choose) several files and upload them with progress. Each file goes straight to
 * storage on a signed URL, then the API checks it and adds it to the library.
 */
@Component({
  selector: 'nv-media-uploader',
  imports: [DsProgressComponent],
  templateUrl: './uploader.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MediaUploader {
  private readonly api = inject(MediaApi);

  readonly spaceId = input.required<string>();
  /** Kinds of file to offer in the file chooser; all by default. */
  readonly accept = input<readonly AssetKind[]>(['image', 'video', 'file']);
  /** New files go in this folder. */
  readonly folder = input<string | null>(null);
  readonly uploaded = output<AssetDetail>();

  protected readonly inputId = `media-upload-${nextId++}`;
  /** The default plan's limits, for the hint; the API checks the space's own. */
  protected readonly limits = {
    image: formatBytes(uploadLimit(null, 'image')),
    other: formatBytes(uploadLimit(null, 'file')),
  };
  protected readonly uploads = signal<Upload[]>([]);
  protected readonly dragging = signal(false);
  private key = 0;

  /** For the file chooser: the extensions of the accepted kinds. */
  protected readonly acceptAttr = computed(() =>
    Object.entries(acceptedFileTypes)
      .filter(([, type]) => this.accept().includes(type.kind))
      .map(([extension]) => `.${extension}`)
      .join(','),
  );

  protected readonly summary = computed(() => {
    const uploads = this.uploads();
    if (!uploads.length) return '';
    const done = uploads.filter((upload) => upload.state === 'done').length;
    const failed = uploads.filter((upload) => upload.state === 'failed').length;
    const busy = uploads.length - done - failed;
    if (busy) return `Uploading ${busy} of ${uploads.length} ${uploads.length === 1 ? 'file' : 'files'}…`;
    return failed ? `${done} uploaded, ${failed} not added.` : `${done} ${done === 1 ? 'file' : 'files'} uploaded.`;
  });

  protected stateText(upload: Upload): string {
    switch (upload.state) {
      case 'uploading':
        return `${upload.progress}%`;
      case 'checking':
        return 'Checking the file…';
      case 'done':
        return 'Added to the library.';
      case 'failed':
        return upload.message ?? 'Not added.';
    }
  }

  protected chosen(event: Event): void {
    const field = event.target as HTMLInputElement;
    void this.start([...(field.files ?? [])]);
    field.value = '';
  }

  protected dragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    this.dragging.set(true);
  }

  protected dropped(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    void this.start([...(event.dataTransfer?.files ?? [])]);
  }

  protected clearFinished(): void {
    this.uploads.update((uploads) => uploads.filter((upload) => upload.state !== 'done' && upload.state !== 'failed'));
  }

  private async start(files: File[]): Promise<void> {
    if (!files.length) return;
    const queued = files.map((file) => ({ file, key: this.key++ }));
    this.uploads.update((uploads) => [
      ...uploads,
      ...queued.map(({ file, key }) => ({
        key,
        name: file.name,
        progress: 0,
        state: 'uploading' as const,
        message: null,
      })),
    ]);
    const queue = [...queued];
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await this.upload(next.file, next.key);
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));
  }

  private async upload(file: File, key: number): Promise<void> {
    const set = (change: Partial<Upload>) =>
      this.uploads.update((uploads) =>
        uploads.map((upload) => (upload.key === key ? { ...upload, ...change } : upload)),
      );
    try {
      const target = await firstValueFrom(this.api.uploadUrl(this.spaceId(), file));
      await this.api.put(target, file, (progress) => set({ progress }));
      set({ state: 'checking', progress: 100 });
      const asset = await firstValueFrom(
        this.api.complete(this.spaceId(), {
          assetId: target.assetId,
          filename: target.filename,
          folder: this.folder(),
        }),
      );
      set({ state: 'done' });
      this.uploaded.emit(asset);
    } catch (error) {
      set({ state: 'failed', message: problemMessage(error) });
    }
  }
}
