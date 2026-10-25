import { ChangeDetectionStrategy, Component, computed, effect, inject, input, linkedSignal, output, signal, untracked } from '@angular/core';
import { type BlockOverrides, type Bucket, BUCKETS, type PartBuckets, ROOT_PART } from '@novan/shared-design-system';
import { ClassChips } from '../class-chips/class-chips';
import { EditorClassIndex } from '../class-index';

/** What each bucket means, as the select says it. */
export const bucketLabels: Readonly<Record<Bucket, string>> = {
  base: 'All screen sizes',
  sm: 'Small screens and up',
  md: 'Medium screens and up',
  lg: 'Large screens and up',
  xl: 'Extra-large screens and up',
  hover: 'On hover',
  focus: 'On focus',
  active: 'While pressed',
  dark: 'In dark mode',
};

const frameworkNames: Readonly<Record<string, string>> = { bootstrap: 'Bootstrap', tailwind: 'Tailwind', css: 'This design system' };

/**
 * The Classes section of the block panel (docs/build/24-design-systems.md): pick one of the block's parts and add
 * CSS classes to it, from the site's own framework or an attached design system, for every screen size or for the
 * breakpoints and states the site's design system can write. The parts are the ones the site says the block rendered,
 * plus those that already have classes, so stale ones can still be cleared. Changes go out as the block's whole
 * `_overrides`, or undefined once nothing is left.
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

  /** The site's design systems, when the editor page provides them. */
  protected readonly index = inject(EditorClassIndex, { optional: true });
  protected readonly adapter = computed(() => this.index?.adapter() ?? null);
  protected readonly suggest = computed(() => (this.index?.label() ? (query: string) => this.index?.suggest(query) ?? Promise.resolve([]) : null));
  protected readonly bucketLabels = bucketLabels;

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

  /** The buckets offered: what the site's adapter can write, and those that already hold classes. */
  protected readonly buckets = computed<Bucket[]>(() => {
    const adapter = this.adapter();
    const offered = new Set<Bucket>(['base', ...(adapter?.breakpoints ?? []), ...(adapter?.states ?? [])]);
    const stored = this.overrides()?.parts?.[this.part()] ?? {};
    for (const bucket of BUCKETS) if (stored[bucket]?.length) offered.add(bucket);
    return BUCKETS.filter((bucket) => offered.has(bucket));
  });

  /** The chosen bucket: kept while it is offered for the same block and part, else every screen size. */
  protected readonly bucket = linkedSignal<{ key: string; buckets: Bucket[] }, Bucket>({
    source: () => ({ key: `${this.uid()}:${this.part()}`, buckets: this.buckets() }),
    computation: (source, previous) =>
      previous && previous.source.key === source.key && source.buckets.includes(previous.value) ? previous.value : 'base',
  });

  protected readonly classes = computed(() => this.overrides()?.parts?.[this.part()]?.[this.bucket()] ?? []);
  protected readonly label = computed(() => partLabel(this.part()));
  protected readonly chipsLabel = computed(() =>
    this.bucket() === 'base' && this.buckets().length === 1
      ? `Classes on ${this.label()}`
      : `Classes on ${this.label()}, ${bucketLabels[this.bucket()].toLowerCase()}`,
  );
  protected readonly anyClasses = computed(() => this.options().some((option) => option.count > 0));
  protected readonly idPrefix = computed(() => `nv-classes-${this.uid()}`);

  /** Classes no attached design system has, by name, as the index answers. */
  private readonly unknown = signal<ReadonlySet<string>>(new Set());
  private readonly checked = new Set<string>();

  protected readonly warnings = computed(() => {
    const adapter = this.adapter();
    const bucket = this.bucket();
    const source = this.index?.label();
    const warnings: Record<string, string> = {};
    for (const name of this.classes()) {
      if (adapter && !adapter.canWrite(name, bucket)) {
        warnings[name] = `${frameworkNames[adapter.framework] ?? 'The design system'} cannot apply this ${bucketLabels[bucket].toLowerCase()}, so it does nothing here.`;
      } else if (source && this.unknown().has(name)) {
        warnings[name] = `Not found in ${source}.`;
      }
    }
    return warnings;
  });

  constructor() {
    // Asks once about each class shown whether an attached design system has it.
    effect(() => {
      const index = this.index;
      if (!index?.label()) return;
      for (const name of this.classes()) {
        if (this.checked.has(name)) continue;
        this.checked.add(name);
        void index.exists(name).then((found) => {
          if (found === false) untracked(() => this.unknown.update((set) => new Set([...set, name])));
        });
      }
    });
  }

  protected readonly classes = computed(() => this.overrides()?.parts?.[this.part()]?.base ?? []);
  protected readonly label = computed(() => partLabel(this.part()));
  protected readonly anyClasses = computed(() => this.options().some((option) => option.count > 0));
  protected readonly idPrefix = computed(() => `nv-classes-${this.uid()}`);

  protected choose(event: Event): void {
    this.part.set((event.target as HTMLSelectElement).value);
    this.pointPart.emit(this.part());
  }

  protected chooseBucket(event: Event): void {
    this.bucket.set((event.target as HTMLSelectElement).value as Bucket);
  }

  protected point(part: string | null): void {
    this.pointPart.emit(part);
  }

  protected setClasses(classes: string[]): void {
    const current = this.overrides();
    const parts: Record<string, PartBuckets> = { ...(current?.parts ?? {}) };
    parts[this.part()] = { ...(parts[this.part()] ?? {}), [this.bucket()]: classes };
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

  protected count(part: string): number {
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
