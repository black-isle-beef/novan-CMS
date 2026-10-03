import { ChangeDetectionStrategy, Component, inject, type OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsAlertComponent, DsBadgeComponent, DsSpinnerComponent } from '@black-isle-beef/novan-design-system';
import { AuthService } from '@novan/admin-auth';
import { roleLabel } from '../roles';
import { SpaceContext } from '../space-context';

@Component({
  selector: 'nv-spaces-page',
  imports: [DsAlertComponent, DsBadgeComponent, DsSpinnerComponent, RouterLink],
  templateUrl: './spaces-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpacesPage implements OnInit {
  protected readonly context = inject(SpaceContext);
  protected readonly auth = inject(AuthService);
  protected readonly roleLabel = roleLabel;

  ngOnInit(): void {
    this.context.currentSpaceId.set(null);
    void this.context.load();
  }
}
