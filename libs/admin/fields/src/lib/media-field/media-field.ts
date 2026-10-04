import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  untracked,
} from '@angular/core';
import type { FieldDefOf } from '@novan/shared-schemas';
import { FieldControl } from '../field-control';
import type { MediaPreview } from '../field-form-context';
import { FieldMessages } from '../field-messages/field-messages';

interface MediaItem {
  assetId: string;
  alt?: string;
}

const kindNames = { image: 'an image', video: 'a video', file: 'a file' } as const;

/**
 * Files from the media library, chosen in the page's picker (`FieldFormContext.media`), each with
 * optional alternative text for this page; empty uses the library's. Stored as `{ assetId, alt }`.
 * Without a media library (tests, read-only previews) it falls back to typing an asset id.
 */
@Component({
  selector: 'nv-media-field',
  imports: [FieldMessages],
  templateUrl: './media-field.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MediaField extends FieldControl<FieldDefOf<'media'>> {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** The items shown: one (possibly empty) for a single field. */
  protected readonly items = computed<MediaItem[]>(() => {
    const value = this.value();
    if (this.field().multiple) return Array.isArray(value) ? (value as MediaItem[]).filter(isItem) : [];
    return [isItem(value) ? value : { assetId: '' }];
  });

  protected readonly library = computed(() => this.context.media());

  /** "Choose an image", "Choose an image or a file". */
  protected readonly what = computed(() => {
    const names = this.field().accept.map((kind) => kindNames[kind]);
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0];
  });

  constructor() {
    super();
    // Previews for the files shown, loaded once each.
    effect(() => {
      const library = this.library();
      const ids = this.items()
        .map((item) => item.assetId)
        .filter(Boolean);
      untracked(() => {
        const missing = ids.filter((id) => !this.context.assets().has(id));
        if (library && missing.length) library.load(missing);
      });
    });
  }

  protected preview(item: MediaItem): MediaPreview | null | undefined {
    return item.assetId ? this.context.assets().get(item.assetId) : undefined;
  }

  protected itemPath(index: number): string {
    return this.field().multiple ? `${this.path()}.${index}` : this.path();
  }

  protected errorsAt(path: string): string[] {
    return this.context.errors()[path] ?? [];
  }

  protected altHint(item: MediaItem): string {
    const libraryAlt = this.preview(item)?.alt?.trim();
    if (libraryAlt) return `Leave empty to use the library's: "${libraryAlt}".`;
    return this.field().requireAlt
      ? 'Describe the image for people who cannot see it. You can also add it in the media library.'
      : 'Describe the image for people who cannot see it, or leave empty if it is only decoration.';
  }

  /** Alt text is needed here only when neither the page nor the library has some. */
  protected altRequired(item: MediaItem): boolean {
    return this.field().requireAlt && !this.preview(item)?.alt?.trim();
  }

  protected itemName(item: MediaItem, index: number): string {
    const preview = this.preview(item);
    const name = preview?.title || preview?.filename;
    return name ?? (this.field().multiple ? `item ${index + 1}` : 'the file');
  }

  protected async choose(index: number | null): Promise<void> {
    const library = this.library();
    if (!library) return;
    const adding = index === null && this.field().multiple;
    const chosen = await library.choose({ accept: this.field().accept, multiple: adding, label: this.field().label });
    if (!chosen?.length) return;
    if (adding) {
      const present = new Set(this.items().map((item) => item.assetId));
      this.value.set([...this.items(), ...chosen.filter((asset) => !present.has(asset.id)).map((asset) => ({ assetId: asset.id }))]);
      this.focusLater(`${this.id()}-change-${this.items().length - 1}`);
      return;
    }
    // A new file keeps the page's own alt text only if it was the same file.
    this.update(index ?? 0, { assetId: chosen[0].id, alt: undefined });
    // The button that opened the picker is replaced by Change and Remove.
    this.focusLater(`${this.id()}-change-${index ?? 0}`);
  }

  protected setAsset(index: number, event: Event): void {
    this.update(index, { assetId: (event.target as HTMLInputElement).value.trim() });
  }

  protected setAlt(index: number, event: Event): void {
    const alt = (event.target as HTMLInputElement).value;
    this.update(index, { alt: alt || undefined });
  }

  protected add(): void {
    this.value.set([...this.items(), { assetId: '' }]);
  }

  protected remove(index: number): void {
    if (this.field().multiple) {
      this.value.set(this.items().filter((_, i) => i !== index));
      // The next item's Change button, else the previous one's, else the add button.
      const next = Math.min(index, this.items().length - 1);
      this.focusLater(next >= 0 && this.library() ? `${this.id()}-change-${next}` : `${this.id()}-add`);
    } else {
      this.value.set(null);
      this.focusLater(`${this.id()}-choose-0`);
    }
  }

  /** Moves focus once the control has re-rendered, so it never falls back to the page. */
  private focusLater(elementId: string): void {
    afterNextRender(() => this.host.nativeElement.ownerDocument.getElementById(elementId)?.focus(), {
      injector: this.injector,
    });
  }

  private update(index: number, change: Partial<MediaItem>): void {
    const items = this.items().map((item, i) => (i === index ? withoutEmptyAlt({ ...item, ...change }) : item));
    if (this.field().multiple) {
      this.value.set(items);
      return;
    }
    const [item] = items;
    // A single field without a file stores nothing.
    this.value.set(item.assetId ? item : null);
  }
}

function isItem(value: unknown): value is MediaItem {
  return typeof value === 'object' && value !== null && typeof (value as MediaItem).assetId === 'string';
}

function withoutEmptyAlt(item: MediaItem): MediaItem {
  return item.alt === undefined ? { assetId: item.assetId } : item;
}
