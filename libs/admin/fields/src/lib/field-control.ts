import { computed, Directive, inject, input, model, type Signal } from '@angular/core';
import type { FieldDef } from '@novan/shared-schemas';
import { FieldFormContext, fieldId } from './field-form-context';

/**
 * What every field control has: its definition, its path in the entry data, its value (two-way bound),
 * and the ids and errors derived from the path.
 */
@Directive()
export abstract class FieldControl<F extends FieldDef = FieldDef> {
  protected readonly context = inject(FieldFormContext);

  readonly field = input.required<F>();
  /** Dotted path of the value in the entry data, e.g. `body.0.heading`. */
  readonly path = input.required<string>();
  readonly value = model<unknown>();

  protected readonly id = computed(() => fieldId(this.path()));
  protected readonly helpId = computed(() => `${this.id()}-help`);
  protected readonly errorId = computed(() => `${this.id()}-error`);
  protected readonly errors = computed(() => this.context.errors()[this.path()] ?? []);
  protected readonly invalid = computed(() => this.errors().length > 0);
  protected readonly disabled = computed(() => this.context.readonly());

  /** A short rule shown after the help text, e.g. "Up to 120 characters." Controls override it. */
  protected readonly hint: Signal<string | null> = computed(() => null);

  /** The help and error ids that describe the control. */
  protected readonly describedBy = computed(() => {
    const help = Boolean(this.field().help || this.hint());
    const ids = [...(help ? [this.helpId()] : []), ...(this.invalid() ? [this.errorId()] : [])];
    return ids.length ? ids.join(' ') : null;
  });
}
