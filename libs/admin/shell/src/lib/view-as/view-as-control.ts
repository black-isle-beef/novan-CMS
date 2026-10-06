import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { DsToastService } from '@black-isle-beef/novan-design-system';
import { ViewAs } from '@novan/admin-auth';
import { ManagementApi, problemMessage, roleLabel } from '@novan/admin-spaces';
import type { SpaceRole } from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';

/**
 * Starts and stops agency staff viewing a space as a role. Each start and stop is audited first; if the audit
 * record cannot be written, nothing changes.
 */
@Injectable({ providedIn: 'root' })
export class ViewAsControl {
  private readonly api = inject(ManagementApi);
  private readonly viewAs = inject(ViewAs);
  private readonly router = inject(Router);
  private readonly toasts = inject(DsToastService);

  async start(spaceId: string, role: SpaceRole): Promise<void> {
    try {
      await firstValueFrom(this.api.viewAs(spaceId, role));
    } catch (error) {
      this.toasts.danger(problemMessage(error), { title: 'Could not view as that role' });
      return;
    }
    this.viewAs.start(spaceId, role);
    // The current screen may be one the role cannot open; the dashboard always opens.
    await this.router.navigate(['/spaces', spaceId]);
    this.toasts.info(`You are viewing this space as ${article(roleLabel(role))}. Changes are turned off.`);
  }

  async stop(): Promise<void> {
    const viewing = this.viewAs.current();
    if (!viewing) return;
    this.viewAs.stop();
    try {
      await firstValueFrom(this.api.viewAs(viewing.spaceId, null));
    } catch {
      // Stopping only gives back the caller's own rights, so it never waits on the audit record.
    }
    this.toasts.info('You are back to your own view.');
  }
}

/** "an Admin", "a Viewer". */
export function article(label: string): string {
  return `${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label}`;
}
