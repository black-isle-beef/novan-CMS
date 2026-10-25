import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import { type BlockOverrides, type PartBuckets, ROOT_PART } from '@novan/shared-design-system';
import { ClassChips } from '../class-chips/class-chips';

/**
 * The Classes section of the block panel (docs/build/24-design-systems.md): pick one of the block's parts and add
 * CSS classes to it, from the site's own framework or an attached design system. The parts are the ones the site
 * says the block rendered, plus those that already have classes, so stale ones can still be cleared. Changes go out
 * as the block's whole `_overrides`, or undefined once nothing is left.
 */
@Component({
  selector: 'nv-class-overrides',
  imports: [ClassChips],
  templateUrl: './class-overrides.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClassOverrides {
  readonly uid = input.required<string>();
  readonly overrides = input<BlockOverrides | undefined>(undefined);
  /** The parts the site reported for this block, in page order; null until it says. */
  readonly parts = input<readonly string[] | null>(null);
  readonly readonly = input(false);

  readonly overridesChange = output<BlockOverrides | undefined>();
  /** The part being chosen or edited, for the site to outline; null when none. */
  readonly pointPart = output<string | null>();

  protected readonly options = computed(() => {
    const stored = Object.keys(this.overrides()?.parts ?? {});
    const names = [ROOT_PART, ...(this.parts() ?? []), ...stored];
    return [...new Set(names)].map((name) => ({ name, label: partLabel(name), count: this.count(name), missing: this.missing(name) }));
  });

  /** The chosen part: kept while the block keeps it, else the whole block. */
  protected readonly part = linkedSignal<{ uid: string; names: string[] }, string>({
    source: () => ({ uid: this.uid(), names: this.options().map((option) => option.name) }),
    computation: (source, previous) =>
      previous && previous.source.uid === source.uid && source.names.includes(previous.value) ? previous.value : ROOT_PART,
  });

  protected readonly classes = computed(() => this.overrides()?.parts?.[this.part()]?.base ?? []);
  protected readonly label = computed(() => partLabel(this.part()));
  protected readonly anyClasses = computed(() => this.options().some((option) => option.count > 0));
  protected readonly idPrefix = computed(() => `nv-classes-${this.uid()}`);

  protected choose(event: Event): void {
    this.part.set((event.target as HTMLSelectElement).value);
    this.pointPart.emit(this.part());
  }

  protected point(part: string | null): void {
    this.pointPart.emit(part);
  }

  protected setClasses(classes: string[]): void {
    const current = this.overrides();
    const parts: Record<string, PartBuckets> = { ...(current?.parts ?? {}) };
    parts[this.part()] = { ...(parts[this.part()] ?? {}), base: classes };
    this.emit({ ...current, parts });
  }

  protected clearPart(): void {
    const current = this.overrides();
    const parts = { ...(current?.parts ?? {}) };
    delete parts[this.part()];
    this.emit({ ...current, parts });
  }

  protected clearAll(): void {
    this.emit({ ...this.overrides(), parts: {} });
  }

  private count(part: string): number {
    return Object.values(this.overrides()?.parts?.[part] ?? {}).reduce((total, names) => total + (names?.length ?? 0), 0);
  }

  /** A part with classes that the site no longer shows (renamed or removed from the block). */
  private missing(part: string): boolean {
    const reported = this.parts();
    return reported !== null && part !== ROOT_PART && !reported.includes(part);
  }

  /** Leaves out empty buckets and parts, and the whole thing when nothing is left. */
  private emit(next: BlockOverrides): void {
    const parts: Record<string, PartBuckets> = {};
    for (const [name, buckets] of Object.entries(next.parts ?? {})) {
      const kept = Object.fromEntries(Object.entries(buckets).filter(([, names]) => names?.length));
      if (Object.keys(kept).length) parts[name] = kept;
    }
    const hasParts = Object.keys(parts).length > 0;
    const hasTokens = Object.keys(next.tokens ?? {}).length > 0;
    if (!hasParts && !hasTokens) {
      this.overridesChange.emit(undefined);
      return;
    }
    this.overridesChange.emit({
      ...(next.v ? { v: next.v } : {}),
      ...(hasParts ? { parts } : {}),
      ...(hasTokens ? { tokens: next.tokens } : {}),
    });
  }
}

/** `root` → "Whole block", `card-title` → "Card title". */
export function partLabel(part: string): string {
  if (part === ROOT_PART) return 'Whole block';
  const words = part.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
