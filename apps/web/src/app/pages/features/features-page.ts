import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsBadgeComponent } from '@black-isle-beef/novan-design-system';
import { features, primaryCta } from '@novan/marketing-content';
import { MkCtaBand, MkHero } from '@novan/marketing-ui';

/** `/features`: one section per feature, each with an anchor the home page links to. */
@Component({
  selector: 'app-features-page',
  imports: [DsBadgeComponent, MkCtaBand, MkHero, RouterLink],
  templateUrl: './features-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeaturesPage {
  protected readonly features = features;
  protected readonly cta = primaryCta;
}
