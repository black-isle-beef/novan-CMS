import { computed, inject, Injectable, signal } from '@angular/core';
import { AuthService } from '@novan/admin-auth';
import type { SpaceSummary } from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { ManagementApi } from './management-api';
import { problemMessage } from './problem';
import { canEditContent, canPublishContent } from './can-edit-content';
import { canModel } from './can-model';

/** The spaces the signed-in user can open, and the one they are working in. */
@Injectable({ providedIn: 'root' })
export class SpaceContext {
  private readonly api = inject(ManagementApi);
  private readonly auth = inject(AuthService);

  readonly spaces = signal<SpaceSummary[] | null>(null);
  readonly error = signal<string | null>(null);
  readonly currentSpaceId = signal<string | null>(null);
  readonly currentSpace = computed(() => this.spaces()?.find((s) => s.id === this.currentSpaceId()) ?? null);

  /** Whether the user can manage people in the current space (space admin, or agency staff). */
  readonly canManageCurrent = computed(() => this.auth.agencyStaff() || this.currentSpace()?.role === 'admin');

  /** Whether the user can see and change the current space's content model (admin, developer, agency staff). */
  readonly canModelCurrent = computed(
    () => this.currentSpace() !== null && canModel(this.currentSpace()?.role, this.auth.agencyStaff()),
  );

  /** Whether the user can save drafts in the current space (authors and up, agency staff). */
  readonly canEditCurrent = computed(
    () => this.currentSpace() !== null && canEditContent(this.currentSpace()?.role, this.auth.agencyStaff()),
  );

  /** Whether the user can publish in the current space (editors and up, agency staff). */
  readonly canPublishCurrent = computed(
    () => this.currentSpace() !== null && canPublishContent(this.currentSpace()?.role, this.auth.agencyStaff()),
  );

  async load(): Promise<void> {
    try {
      this.spaces.set(await firstValueFrom(this.api.listSpaces()));
      this.error.set(null);
    } catch (error) {
      this.error.set(problemMessage(error));
    }
  }

  clear(): void {
    this.spaces.set(null);
    this.currentSpaceId.set(null);
    this.error.set(null);
  }
}
