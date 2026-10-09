import { computed, Directive, inject, input, model, type Signal } from '@angular/core';
import { type FieldDef, isTranslated } from '@novan/shared-schemas';
import { FieldFormContext, fieldId, FieldScope } from './field-form-context';

/**
 * What every field control has: its definition, its path in the entry data (`title.fr-FR` for one locale's value of
 * a translated field), its value (two-way bound), and the ids and errors derived from the path.
 */
@Directive()
export abstract class FieldControl<F extends FieldDef = FieldDef> {
  protected readonly context = inject(FieldFormContext);
  private readonly scope = inject(FieldScope, { optional: true });

  readonly field = input.required<F>();
  /** Dotted path of the value in the entry data, e.g. `body.0.heading`. */
  readonly path = input.required<string>();
  readonly value = model<unknown>();

  /** The locale shown, for translated values inside this control. */
  protected readonly locale = computed(() => this.scope?.scopeLocale() ?? this.context.activeLocale());
  /**
   * A value every locale shares (not translated) is changed in the default locale only. Groups and blocks keep their
   * structure there; the fields inside them decide for themselves.
   */
  protected readonly shared = computed(() => !isTranslated(this.field()) && this.locale() !== this.context.defaultLocale());

  /**
   * The language of the value, for `lang` on the element holding it (WCAG 3.1.2), so screen readers read a translation
   * in its own voice. Only for translated values; the labels around them stay in the admin's language.
   */
  protected readonly contentLang = computed(() => (isTranslated(this.field()) ? this.locale() : null));

  protected readonly id = computed(() => fieldId(this.path()));
  protected readonly helpId = computed(() => `${this.id()}-help`);
  protected readonly errorId = computed(() => `${this.id()}-error`);
  protected readonly errors = computed(() => this.context.errors()[this.path()] ?? []);
  protected readonly invalid = computed(() => this.errors().length > 0);
  /** Nothing here can change: the form or this part of it is read-only. */
  protected readonly readOnly = computed(() => this.context.readonly() || (this.scope?.scopeLocked() ?? false));
  /** This control cannot change its value; fields inside groups and blocks may still change theirs. */
  protected readonly disabled = computed(() => this.readOnly() || this.shared());

  /** A short rule shown after the help text, e.g. "Up to 120 characters." Controls override it. */
  protected readonly hint: Signal<string | null> = computed(() => null);

  /** The help and error ids that describe the control. */
  protected readonly describedBy = computed(() => {
    const help = Boolean(this.field().help || this.hint());
    const ids = [...(help ? [this.helpId()] : []), ...(this.invalid() ? [this.errorId()] : [])];
    return ids.length ? ids.join(' ') : null;
  });
}
