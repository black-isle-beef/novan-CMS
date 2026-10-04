import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Asset } from '@novan/shared-schemas';

const icons: Record<string, string> = {
  'application/pdf': 'bi-file-earmark-pdf',
  'text/csv': 'bi-filetype-csv',
  'text/plain': 'bi-file-earmark-text',
  'application/zip': 'bi-file-earmark-zip',
};

/**
 * A square preview of a library file: the image itself, or an icon for videos and documents. It is
 * decorative (`alt=""`): whatever shows it also shows the file's name.
 */
@Component({
  selector: 'nv-asset-thumb',
  template: `
    <div class="ratio ratio-1x1 bg-body-tertiary rounded overflow-hidden">
      @if (url(); as src) {
        <img class="object-fit-contain w-100 h-100" [src]="src" alt="" loading="lazy" />
      } @else {
        <div class="d-flex align-items-center justify-content-center text-body-secondary">
          <i class="bi fs-1" [class]="icon()" aria-hidden="true"></i>
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetThumb {
  readonly asset = input.required<Pick<Asset, 'kind' | 'mime'>>();
  readonly url = input<string | null | undefined>(null);

  protected readonly icon = computed(() => {
    const { kind, mime } = this.asset();
    if (kind === 'video') return 'bi-film';
    if (kind === 'image') return 'bi-image';
    if (icons[mime]) return icons[mime];
    if (mime.includes('word')) return 'bi-file-earmark-word';
    if (mime.includes('sheet') || mime.includes('excel')) return 'bi-file-earmark-excel';
    if (mime.includes('presentation') || mime.includes('powerpoint')) return 'bi-file-earmark-ppt';
    return 'bi-file-earmark';
  });
}
