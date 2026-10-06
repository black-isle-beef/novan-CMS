import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { DsDropdownComponent, DsMenuItemComponent } from '@black-isle-beef/novan-design-system';
import { ViewAs } from '@novan/admin-auth';
import { roleOptions } from '@novan/admin-spaces';
import { ViewAsControl } from './view-as-control';

/** Header menu for agency staff: see the current space as one of its roles, or stop. */
@Component({
  selector: 'nv-view-as-menu',
  imports: [DsDropdownComponent, DsMenuItemComponent],
  template: `
    <ds-dropdown label="View as" position="bottom-end">
      <span dsDropdownTrigger>
        <i class="bi bi-eye me-1" aria-hidden="true"></i>View as
        <i class="bi bi-chevron-down ms-1" aria-hidden="true"></i>
      </span>
      @for (role of roles; track role.key) {
        <ds-menu-item (activated)="control.start(spaceId(), role.key)">
          {{ role.label }}
          @if (viewAs.roleIn(spaceId()) === role.key) {
            <i class="bi bi-check2 ms-2" aria-hidden="true"></i><span class="visually-hidden"> (current)</span>
          }
        </ds-menu-item>
      }
      @if (viewAs.roleIn(spaceId())) {
        <ds-menu-item (activated)="control.stop()">Stop viewing as</ds-menu-item>
      }
    </ds-dropdown>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewAsMenu {
  readonly spaceId = input.required<string>();

  protected readonly roles = roleOptions;
  protected readonly viewAs = inject(ViewAs);
  protected readonly control = inject(ViewAsControl);
}
