import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import type { SpaceLocale } from '@novan/shared-schemas';

/**
 * Chooses the language a page is edited in (docs/build/16-localisation.md), and, in another language than the
 * default, whether to show the default language's text alongside to translate from. Languages with translations
 * missing are marked.
 */
@Component({
  selector: 'nv-locale-switcher',
  templateUrl: './locale-switcher.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LocaleSwitcher {
  readonly locales = input.required<readonly SpaceLocale[]>();
  /** Languages with translations missing. */
  readonly missing = input<readonly string[]>([]);
  /** Offer the side-by-side view. */
  readonly sideBySide = input(true);
  /** Prefix of the controls' ids, for pages with more than one. */
  readonly idPrefix = input('locale');
  /** The language shown; null for the default. */
  readonly locale = model<string | null>(null);
  /** The language shown alongside; null for none. */
  readonly compare = model<string | null>(null);

  protected readonly defaultLocale = computed(() => this.locales().find((locale) => locale.isDefault) ?? null);
  protected readonly shown = computed(() => this.locale() ?? this.defaultLocale()?.code ?? '');
  protected readonly translating = computed(() => this.shown() !== this.defaultLocale()?.code);

  protected label(locale: SpaceLocale): string {
    if (locale.isDefault) return `${locale.name} (main language)`;
    return this.missing().includes(locale.code) ? `${locale.name} (needs translation)` : locale.name;
  }

  protected choose(event: Event): void {
    const code = (event.target as HTMLSelectElement).value;
    const isDefault = code === this.defaultLocale()?.code;
    this.locale.set(isDefault ? null : code);
    if (isDefault) this.compare.set(null);
  }

  protected toggleCompare(event: Event): void {
    this.compare.set((event.target as HTMLInputElement).checked ? (this.defaultLocale()?.code ?? null) : null);
  }
}
