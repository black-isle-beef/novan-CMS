import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DsButtonComponent } from '@black-isle-beef/novan-design-system';
import { roleLabel } from '@novan/admin-spaces';
import type { SpaceRole } from '@novan/shared-schemas';
import { article, ViewAsControl } from './view-as-control';

/** Stays at the top of every screen while agency staff view the space as a role. */
@Component({
  selector: 'nv-view-as-banner',
  imports: [DsButtonComponent],
  template: `
    <!-- Not a heading: it sits above each screen's h1. -->
    <section class="alert alert-warning d-flex flex-wrap align-items-center justify-content-between gap-2 mb-4" aria-label="Viewing as">
      <p class="mb-0">
        <strong>Viewing as {{ label() }}.</strong> This is what {{ who() }} sees. It is read only: nothing you do here is saved.
      </p>
      <ds-button variant="secondary" size="sm" (pressed)="control.stop()">Stop viewing as</ds-button>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewAsBanner {
  readonly role = input.required<SpaceRole>();

  protected readonly control = inject(ViewAsControl);
  protected readonly label = computed(() => roleLabel(this.role()));
  protected readonly who = computed(() => article(this.label().toLowerCase()));
}
