import { computed, Injectable, signal } from '@angular/core';
import { type EntryData, sameJson } from '@novan/shared-schemas';
import { applyPatches, diff, type Patch } from './patches';

/** Undo keeps this many steps. */
export const HISTORY_LIMIT = 100;
/** Changes with the same key this close together are one step (typing a word is not ten undos). */
export const COALESCE_MS = 1000;

interface Step {
  forward: Patch[];
  back: Patch[];
  /** What the change was to, for joining the next one to it. */
  key: string | null;
  at: number;
}

/**
 * The visual editor's state (docs/build/12-visual-editor.md): the page data, the selected block, whether
 * there are unsaved changes, and undo/redo. History holds patches (only what changed), not copies of the page.
 * Provide one per editor page.
 */
@Injectable()
export class EditorStore {
  private readonly current = signal<EntryData>({});
  private readonly savedData = signal<EntryData>({});
  private readonly undoStack = signal<readonly Step[]>([]);
  private readonly redoStack = signal<readonly Step[]>([]);

  /** The page data as the editor has it, unsaved changes included. */
  readonly data = this.current.asReadonly();
  /** The selected block's `_uid`. */
  readonly selected = signal<string | null>(null);
  readonly dirty = computed(() => !sameJson(this.current(), this.savedData()));
  readonly canUndo = computed(() => this.undoStack().length > 0);
  readonly canRedo = computed(() => this.redoStack().length > 0);

  /** Starts over with a page as loaded or restored: no history, nothing unsaved. */
  load(data: EntryData): void {
    this.current.set(data);
    this.savedData.set(data);
    this.undoStack.set([]);
    this.redoStack.set([]);
  }

  /**
   * Makes `next` the page data as one undoable step. A change with the same `key` as the step before, within
   * {@link COALESCE_MS}, joins that step.
   */
  change(next: EntryData, key: string | null = null, now = Date.now()): void {
    const before = this.current();
    const forward = diff(before, next);
    if (!forward.length) return;
    const back = diff(next, before);
    const steps = this.undoStack();
    const last = steps[steps.length - 1];
    if (key !== null && last?.key === key && now - last.at < COALESCE_MS && !this.redoStack().length) {
      const start = applyPatches(before, last.back);
      this.undoStack.set([...steps.slice(0, -1), { forward: diff(start, next), back: diff(next, start), key, at: now }]);
    } else {
      this.undoStack.set([...steps, { forward, back, key, at: now }].slice(-HISTORY_LIMIT));
    }
    this.redoStack.set([]);
    this.current.set(next);
  }

  undo(): boolean {
    const steps = this.undoStack();
    const step = steps[steps.length - 1];
    if (!step) return false;
    this.undoStack.set(steps.slice(0, -1));
    this.redoStack.set([...this.redoStack(), step]);
    this.current.set(applyPatches(this.current(), step.back));
    return true;
  }

  redo(): boolean {
    const steps = this.redoStack();
    const step = steps[steps.length - 1];
    if (!step) return false;
    this.redoStack.set(steps.slice(0, -1));
    this.undoStack.set([...this.undoStack(), { ...step, key: null }]);
    this.current.set(applyPatches(this.current(), step.forward));
    return true;
  }

  /** Records that `data` is what the server now has (history stays, so a save can still be undone). */
  markSaved(data: EntryData): void {
    this.savedData.set(data);
  }
}
