import { ChangeDetectionStrategy, Component, computed, DestroyRef, type ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { CLASS_TOKEN, MAX_CLASSES_PER_BUCKET } from '@novan/shared-design-system';
import type { ClassSuggestion } from '../class-index';

/** How long typing pauses before suggestions are asked for. */
const SUGGEST_DELAY_MS = 200;

/**
 * A list of CSS class names as removable chips, with a text box to add more (Enter or the Add button; several at
 * once, separated by spaces). With `suggest`, the text box is a combobox offering the site's design system classes
 * for the word being typed (arrow keys to choose, Enter to pick, Escape to close). Names are checked for shape only:
 * anything a class attribute could not safely hold is refused with a message. `warnings` are shown by name. Changes
 * are announced, and focus stays in the text box.
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
  /** Classes starting with what is typed, from the site's design systems; null when it has none. */
  readonly suggest = input<((query: string) => Promise<ClassSuggestion[]>) | null>(null);
  /** Something to know about a class already added, by name (it does nothing here, or no design system has it). */
  readonly warnings = input<Readonly<Record<string, string>>>({});
  readonly classesChange = output<string[]>();

  protected readonly draft = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly announcement = signal('');
  protected readonly options = signal<ClassSuggestion[]>([]);
  protected readonly active = signal(-1);
  protected readonly full = computed(() => this.classes().length >= MAX_CLASSES_PER_BUCKET);
  protected readonly describedBy = computed(() => `${this.inputId()}-hint${this.error() ? ` ${this.inputId()}-error` : ''}`);
  protected readonly listId = computed(() => `${this.inputId()}-suggestions`);
  protected readonly activeId = computed(() => (this.active() >= 0 ? `${this.listId()}-${this.active()}` : null));
  protected readonly warned = computed(() =>
    this.classes()
      .filter((name) => this.warnings()[name])
      .map((name) => ({ name, message: this.warnings()[name] })),
  );

  private readonly box = viewChild<ElementRef<HTMLInputElement>>('box');
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.timer && clearTimeout(this.timer));
  }
  protected readonly full = computed(() => this.classes().length >= MAX_CLASSES_PER_BUCKET);
  protected readonly describedBy = computed(() => `${this.inputId()}-hint${this.error() ? ` ${this.inputId()}-error` : ''}`);

  private readonly box = viewChild<ElementRef<HTMLInputElement>>('box');

  protected typed(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
    this.error.set(null);
    this.queueSuggestions();
  }

  protected keydown(event: KeyboardEvent): void {
    const count = this.options().length;
    if (event.key === 'ArrowDown' && count) {
      event.preventDefault();
      this.active.set((this.active() + 1) % count);
    } else if (event.key === 'ArrowUp' && count) {
      event.preventDefault();
      this.active.set(this.active() <= 0 ? count - 1 : this.active() - 1);
    } else if (event.key === 'Escape' && count) {
      event.preventDefault();
      this.closeSuggestions();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = this.options()[this.active()];
      if (chosen) this.pick(chosen);
      else this.add();
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

  /** Puts the suggestion in place of the word being typed, and adds what is typed. */
  protected pick(option: ClassSuggestion): void {
    const words = this.draft().split(/\s+/).filter(Boolean);
    words[Math.max(0, words.length - 1)] = option.name;
    this.draft.set(words.join(' '));
    this.add();
  }

  protected add(): void {
    this.closeSuggestions();
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

  protected closeSuggestions(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.options.set([]);
    this.active.set(-1);
  }

  /** Asks for classes starting with the word being typed, once typing pauses; only the latest answer is shown. */
  private queueSuggestions(): void {
    const suggest = this.suggest();
    if (this.timer) clearTimeout(this.timer);
    const word = this.draft().split(/\s+/).pop() ?? '';
    if (!suggest || !word || /\s$/.test(this.draft())) {
      this.closeSuggestions();
      return;
    }
    this.timer = setTimeout(async () => {
      this.timer = null;
      const found = (await suggest(word)).filter((option) => !this.classes().includes(option.name));
      if ((this.draft().split(/\s+/).pop() ?? '') !== word) return;
      this.options.set(found);
      this.active.set(-1);
      if (found.length) this.announcement.set(`${found.length} suggestion${found.length === 1 ? '' : 's'}. Use the arrow keys to choose.`);
    }, SUGGEST_DELAY_MS);
  }
}
