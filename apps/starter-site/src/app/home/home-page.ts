import { ChangeDetectionStrategy, Component } from '@angular/core';
import { DsHeaderComponent, type NavItem } from '@black-isle-beef/novan-design-system';

/** Placeholder home page. Pages are rendered from CMS content once the SDK and blocks land (packages 09–10). */
@Component({
  selector: 'site-home-page',
  imports: [DsHeaderComponent],
  templateUrl: './home-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {
  protected readonly navItems: NavItem[] = [];
}
