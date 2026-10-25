import { ChangeDetectionStrategy, Component, computed, type ElementRef, input, output, signal, viewChild } from '@angular/core';
import { CLASS_TOKEN, MAX_CLASSES_PER_BUCKET } from '@novan/shared-design-system';

/**
 * A list of CSS class names as removable chips, with a text box to add more (Enter or the Add button; several at
 * once, separated by spaces). Names are checked for shape only: anything a class attribute could not safely hold
 * is refused with a message. Additions and removals are announced, and focus stays in the text box.
 */
@Component({
  selector: 'nv-class-chips',
  templateUrl: './class-chips.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClassChips {
  readonly classes = input<readonly string[]>([]);
  readonly label = input.required<string>();
  /** The text box's id; unique on the page. */
  readonly inputId = input.required<string>();
  readonly disabled = input(false);
  readonly classesChange = output<string[]>();

  protected readonly draft = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly announcement = signal('');
  protected readonly full = computed(() => this.classes().length >= MAX_CLASSES_PER_BUCKET);
  protected readonly describedBy = computed(() => `${this.inputId()}-hint${this.error() ? ` ${this.inputId()}-error` : ''}`);

  private readonly box = viewChild<ElementRef<HTMLInputElement>>('box');

  protected typed(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  protected keydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.add();
    } else if (event.key === 'Backspace' && this.draft() === '' && this.classes().length) {
      event.preventDefault();
      this.remove(this.classes()[this.classes().length - 1]);
    }
  }

  protected add(): void {
    const names = this.draft().split(/\s+/).filter(Boolean);
    if (!names.length) return;
    const bad = names.find((name) => !CLASS_TOKEN.test(name));
    if (bad) {
      this.refuse(`"${bad.slice(0, 40)}" is not a class name. Use letters, numbers and - _ : / . [ ] # % ( ) ! , @ only.`);
      return;
    }
    const added = [...new Set(names)].filter((name) => !this.classes().includes(name));
    const next = [...this.classes(), ...added];
    if (next.length > MAX_CLASSES_PER_BUCKET) {
      this.refuse(`Use ${MAX_CLASSES_PER_BUCKET} classes or fewer here.`);
      return;
    }
    this.draft.set('');
    // The binding last wrote '' too, so it would not clear what was typed since.
    const box = this.box()?.nativeElement;
    if (box) box.value = '';
    this.error.set(null);
    if (added.length) {
      this.classesChange.emit(next);
      this.announcement.set(`Added ${added.join(', ')}.`);
    } else {
      this.announcement.set(`${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} already added.`);
    }
  }

  /** Shows the problem by the text box and announces it, as Enter otherwise seems to do nothing. */
  private refuse(message: string): void {
    this.error.set(message);
    this.announcement.set(message);
  }

  protected remove(name: string): void {
    this.classesChange.emit(this.classes().filter((candidate) => candidate !== name));
    this.announcement.set(`Removed ${name}.`);
    // The chip's button goes away with it; the text box is the next sensible place.
    this.box()?.nativeElement.focus();
  }
}
