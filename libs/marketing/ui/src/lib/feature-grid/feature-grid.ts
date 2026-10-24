import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsBadgeComponent } from '@black-isle-beef/novan-design-system';
import type { Feature } from '@novan/marketing-content';

/** Feature cards, each titled with a link to its section on /features. Planned features say so in text. */
@Component({
  selector: 'mk-feature-grid',
  imports: [DsBadgeComponent, RouterLink],
  templateUrl: './feature-grid.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MkFeatureGrid {
  readonly features = input.required<readonly Feature[]>();
}
