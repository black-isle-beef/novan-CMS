import { computed, inject, Injectable, signal } from '@angular/core';
import { AuthService, ViewAs } from '@novan/admin-auth';
import type { SpaceSummary } from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { ManagementApi } from './management-api';
import { problemMessage } from './problem';
import { canEditContent, canPublishContent } from './can-edit-content';
import { hasPermission, isAgencyMode, type Permission, type SpaceAccess } from './permissions';

/** The spaces the signed-in user can open, and the one they are working in. */
@Injectable({ providedIn: 'root' })
export class SpaceContext {
  private readonly api = inject(ManagementApi);
  private readonly auth = inject(AuthService);
  private readonly viewAs = inject(ViewAs);

  readonly spaces = signal<SpaceSummary[] | null>(null);
  readonly error = signal<string | null>(null);
  readonly currentSpaceId = signal<string | null>(null);
  readonly currentSpace = computed(() => this.spaces()?.find((s) => s.id === this.currentSpaceId()) ?? null);

  /** The role agency staff are viewing the current space as, or null. */
  readonly viewingAs = computed(() => this.viewAs.roleIn(this.currentSpaceId()));

  /** The caller's access to the current space, or the viewed role's while viewing as one. Null outside a space. */
  readonly currentAccess = computed<SpaceAccess | null>(() => {
    const space = this.currentSpace();
    if (!space) return null;
    const viewed = this.viewingAs();
    return viewed ? { role: viewed, agencyStaff: false } : { role: space.role, agencyStaff: this.auth.agencyStaff() };
  });

  /** Agency mode (admins, developers, agency staff) or client mode (editors, authors, viewers). */
  readonly agencyMode = computed(() => {
    const access = this.currentAccess();
    return access !== null && isAgencyMode(access);
  });

  /** Whether the user can manage people in the current space (space admin, or agency staff). */
  readonly canManageCurrent = computed(() => this.viewingAs() === null && this.can('space.update'));

  /** Whether the user can see and change the current space's content model (admin, developer, agency staff). */
  readonly canModelCurrent = computed(() => this.can('schema.write'));

  /** Whether the user can save drafts in the current space (authors and up, agency staff). Never while viewing as. */
  readonly canEditCurrent = computed(() => {
    const access = this.currentAccess();
    return access !== null && this.viewingAs() === null && canEditContent(access.role, access.agencyStaff);
  });

  /** Whether the user can publish in the current space (editors and up, agency staff). Never while viewing as. */
  readonly canPublishCurrent = computed(() => {
    const access = this.currentAccess();
    return access !== null && this.viewingAs() === null && canPublishContent(access.role, access.agencyStaff);
  });

  /** Whether the current space grants `permission` (reactive inside templates and computeds). */
  can(permission: Permission): boolean {
    const access = this.currentAccess();
    return access !== null && hasPermission(permission, access);
  }

  async load(): Promise<void> {
    try {
      this.spaces.set(await firstValueFrom(this.api.listSpaces()));
      this.error.set(null);
    } catch (error) {
      this.error.set(problemMessage(error));
    }
  }

  /** Puts an updated space (e.g. renamed in Space settings) into the list. */
  replace(space: SpaceSummary): void {
    this.spaces.update((spaces) => spaces?.map((s) => (s.id === space.id ? space : s)) ?? null);
  }

  clear(): void {
    this.spaces.set(null);
    this.currentSpaceId.set(null);
    this.error.set(null);
    this.viewAs.stop();
  }
}
