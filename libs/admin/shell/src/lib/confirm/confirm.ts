import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  /** The question, e.g. "Unpublish About us?". Also the dialog's name. */
  heading: string;
  /** What happens, and whether it can be undone. */
  body: string;
  /** The confirming button, named for what it does, e.g. "Unpublish". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Styles the confirming button as dangerous. */
  destructive?: boolean;
}

export interface ConfirmRequest extends Required<ConfirmOptions> {
  answer: (confirmed: boolean) => void;
}

/**
 * Asks the person to confirm an action in a design-system dialog (shown by `<nv-confirm-host>` in the shell).
 * Resolves true only when they choose the confirming button; Escape, the close button and Cancel resolve false.
 */
@Injectable({ providedIn: 'root' })
export class Confirm {
  private readonly current = signal<ConfirmRequest | null>(null);

  readonly request = this.current.asReadonly();

  ask(options: ConfirmOptions): Promise<boolean> {
    // A newer question replaces an unanswered one, which counts as cancelled.
    this.current()?.answer(false);
    return new Promise<boolean>((resolve) => {
      const request: ConfirmRequest = {
        cancelLabel: 'Cancel',
        destructive: false,
        ...options,
        answer: (confirmed) => {
          if (this.current() === request) this.current.set(null);
          resolve(confirmed);
        },
      };
      this.current.set(request);
    });
  }
}
