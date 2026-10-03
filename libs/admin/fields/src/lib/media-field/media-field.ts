import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import type { FieldDefOf } from '@novan/shared-schemas';
import { FieldControl } from '../field-control';
import { FieldMessages } from '../field-messages/field-messages';

interface MediaItem {
  assetId: string;
  alt?: string;
}

/**
 * Media by asset id, with alternative text. The media library (package 07) replaces the id box with a
 * picker; the stored value stays `{ assetId, alt }`.
 */
@Component({
  selector: 'nv-media-field',
  imports: [FieldMessages],
  templateUrl: './media-field.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MediaField extends FieldControl<FieldDefOf<'media'>> {
  /** The items shown: one (possibly empty) for a single field. */
  protected readonly items = computed<MediaItem[]>(() => {
    const value = this.value();
    if (this.field().multiple) return Array.isArray(value) ? (value as MediaItem[]) : [];
    return [isItem(value) ? value : { assetId: '' }];
  });

  protected readonly altHint = computed(() =>
    this.field().requireAlt
      ? 'Describe the image for people who cannot see it.'
      : 'Describe the image for people who cannot see it, or leave empty if it is only decoration.',
  );

  protected itemPath(index: number): string {
    return this.field().multiple ? `${this.path()}.${index}` : this.path();
  }

  protected errorsAt(path: string): string[] {
    return this.context.errors()[path] ?? [];
  }

  protected setAsset(index: number, event: Event): void {
    this.update(index, { assetId: (event.target as HTMLInputElement).value.trim() });
  }

  protected setAlt(index: number, event: Event): void {
    this.update(index, { alt: (event.target as HTMLInputElement).value });
  }

  protected add(): void {
    this.value.set([...this.items(), { assetId: '' }]);
  }

  protected remove(index: number): void {
    this.value.set(this.items().filter((_, i) => i !== index));
  }

  private update(index: number, change: Partial<MediaItem>): void {
    const items = this.items().map((item, i) => (i === index ? { ...item, ...change } : item));
    if (this.field().multiple) {
      this.value.set(items);
      return;
    }
    const [item] = items;
    // An empty single field stores nothing.
    this.value.set(item.assetId || item.alt ? item : null);
  }
}

function isItem(value: unknown): value is MediaItem {
  return typeof value === 'object' && value !== null && typeof (value as MediaItem).assetId === 'string';
}
