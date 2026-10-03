import { ChangeDetectionStrategy, Component, computed, effect, signal, untracked } from '@angular/core';
import { type FieldDefOf, sameJson } from '@novan/shared-schemas';
import { FieldControl } from '../field-control';
import { FieldMessages } from '../field-messages/field-messages';

/** Free JSON, for developers. Text that is not JSON yet is kept in the box but not stored. */
@Component({
  selector: 'nv-json-field',
  imports: [FieldMessages],
  templateUrl: './json-field.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JsonField extends FieldControl<FieldDefOf<'json'>> {
  protected readonly text = signal('');
  private readonly parseError = signal<string | null>(null);

  /** The control's own parse error comes before the validation errors. */
  protected readonly allErrors = computed(() => [...(this.parseError() ? [this.parseError() as string] : []), ...this.errors()]);
  protected readonly showsError = computed(() => this.allErrors().length > 0);
  protected readonly describedByAll = computed(() => {
    const ids = [...(this.field().help ? [this.helpId()] : []), ...(this.showsError() ? [this.errorId()] : [])];
    return ids.length ? ids.join(' ') : null;
  });

  constructor() {
    super();
    // Show a value that changed elsewhere (a restored version), unless it is what the box already holds.
    effect(() => {
      const value = this.value();
      untracked(() => {
        if (this.parseError() === null && sameJson(parse(this.text()), value ?? null)) return;
        this.text.set(value === undefined || value === null ? '' : JSON.stringify(value, null, 2));
        this.parseError.set(null);
      });
    });
  }

  protected set(event: Event): void {
    const text = (event.target as HTMLTextAreaElement).value;
    this.text.set(text);
    if (!text.trim()) {
      this.parseError.set(null);
      this.value.set(null);
      return;
    }
    try {
      const value: unknown = JSON.parse(text);
      this.parseError.set(null);
      this.value.set(value);
    } catch {
      this.parseError.set('This is not valid JSON yet, so it has not been kept.');
    }
  }
}

function parse(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
