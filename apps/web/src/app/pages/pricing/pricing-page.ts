import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsAccordionItemComponent } from '@black-isle-beef/novan-design-system';
import { pricing, primaryCta } from '@novan/marketing-content';
import { MkCtaBand, MkHero, MkPricingCard } from '@novan/marketing-ui';

// TODO(pricing): plans, prices and limits come from pricing.data.ts and are placeholders.

/** `/pricing`: the plans, a comparison table and common questions. Monthly only: the data has no annual prices. */
@Component({
  selector: 'app-pricing-page',
  imports: [DsAccordionItemComponent, MkCtaBand, MkHero, MkPricingCard, RouterLink],
  templateUrl: './pricing-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PricingPage {
  protected readonly pricing = pricing;
  protected readonly cta = primaryCta;
}
