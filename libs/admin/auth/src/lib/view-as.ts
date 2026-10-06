import { Injectable, signal } from '@angular/core';
import type { SpaceRole } from '@novan/shared-schemas';

export interface ViewingAs {
  spaceId: string;
  role: SpaceRole;
}

/**
 * Agency staff looking at one space as one of its roles (package 11). UI only: the menu, guards and screens
 * behave as for that role, every change is turned off (the shell's read-only interceptor refuses writes too),
 * and the API keeps answering with the caller's real rights. Starting and stopping is audited by the shell.
 * Not kept across reloads: a reload shows the admin as it really is.
 */
@Injectable({ providedIn: 'root' })
export class ViewAs {
  private readonly state = signal<ViewingAs | null>(null);

  readonly current = this.state.asReadonly();

  /** The role being viewed as in this space, or null. */
  roleIn(spaceId: string | null | undefined): SpaceRole | null {
    const state = this.state();
    return state && state.spaceId === spaceId ? state.role : null;
  }

  start(spaceId: string, role: SpaceRole): void {
    this.state.set({ spaceId, role });
  }

  stop(): void {
    this.state.set(null);
  }
}
