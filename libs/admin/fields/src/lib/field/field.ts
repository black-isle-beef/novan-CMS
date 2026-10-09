import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { fallbackChain, type FieldDef, isEmptyValue, isTranslated, translationOf, withTranslation } from '@novan/shared-schemas';
import { FieldFormContext, FieldScope } from '../field-form-context';
import { FieldInput } from './field-input';

/**
 * One field of a form. A translated field (docs/build/16-localisation.md) stores a value per locale: the control edits
 * the locale shown, at `<path>.<locale>`, and says when that locale has no translation yet. In the side-by-side view
 * (`FieldFormContext.compareLocale`) the source locale's value is shown read-only next to it.
 */
@Component({
  selector: 'nv-field',
  imports: [FieldInput],
  templateUrl: './field.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Field {
  protected readonly context = inject(FieldFormContext);
  private readonly scope = inject(FieldScope, { optional: true });

  readonly field = input.required<FieldDef>();
  readonly path = input.required<string>();
  readonly value = model<unknown>();

  protected readonly translated = computed(() => isTranslated(this.field()));
  protected readonly locale = computed(() => this.scope?.scopeLocale() ?? this.context.activeLocale());
  private readonly multilingual = computed(() => this.context.locales().length > 1);

  /** The locale to translate from, shown alongside; null outside the side-by-side view or when it is this locale. */
  protected readonly compare = computed(() => {
    const source = this.context.compareLocale();
    return source && source !== this.locale() && !this.scope?.scopeLocked() ? source : null;
  });

  /** Nothing in this locale yet, though the default locale has something: the site shows a fallback. */
  protected readonly untranslated = computed(() => {
    const locale = this.locale();
    const defaultLocale = this.context.defaultLocale();
    return (
      this.translated() &&
      locale !== defaultLocale &&
      isEmptyValue(translationOf(this.value(), locale, defaultLocale)) &&
      !isEmptyValue(translationOf(this.value(), defaultLocale, defaultLocale))
    );
  });

  /** The locale whose value the site shows instead, along the fallbacks; null when there is none. */
  protected readonly fallbackName = computed(() => {
    const defaultLocale = this.context.defaultLocale();
    const from = fallbackChain(this.context.locales(), this.locale())
      .slice(1)
      .find((locale) => !isEmptyValue(translationOf(this.value(), locale, defaultLocale)));
    return from ? this.context.localeName(from) : null;
  });

  /**
   * The field as one locale's control shows it: named with the locale when the space has several. Only the default
   * locale's value is required; other locales may be left to fall back.
   */
  protected fieldIn(locale: string): FieldDef {
    const field = this.field();
    if (!this.multilingual()) return field;
    const required = field.required && locale === this.context.defaultLocale();
    // Said with the control's help, so screen readers announce it on focus.
    const note = locale === this.locale() && this.untranslated() ? this.untranslatedNote() : null;
    const help = [field.help, note].filter(Boolean).join(' ') || undefined;
    return { ...field, label: `${field.label} (${this.context.localeName(locale)})`, required, help } as FieldDef;
  }

  private untranslatedNote(): string {
    const from = this.fallbackName();
    return from
      ? `Not translated yet: the site shows the ${from} text until you add one.`
      : 'Not translated yet: the site shows nothing here until you add one.';
  }

  protected pathIn(locale: string): string {
    return `${this.path()}.${locale}`;
  }

  protected valueIn(locale: string): unknown {
    return translationOf(this.value(), locale, this.context.defaultLocale());
  }

  protected setIn(locale: string, value: unknown): void {
    this.value.set(withTranslation(this.value(), locale, value, this.context.defaultLocale()));
  }
}
