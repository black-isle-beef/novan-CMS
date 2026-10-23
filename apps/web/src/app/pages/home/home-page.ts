import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { features, howItWorks, pricing, primaryCta, testimonials } from '@novan/marketing-content';
import { MkCtaBand, MkFeatureGrid, MkHero } from '@novan/marketing-ui';

const pounds = new Intl.NumberFormat('en-GB', { style: 'currency', currency: pricing.currency, maximumFractionDigits: 0 });

/** `/`: the hero, feature highlights, how it works, client quotes (once there are some), a pricing teaser and a CTA. */
@Component({
  selector: 'app-home-page',
  imports: [MkCtaBand, MkFeatureGrid, MkHero, RouterLink],
  templateUrl: './home-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {
  protected readonly cta = primaryCta;
  protected readonly highlights = features.filter((feature) => feature.highlight);
  protected readonly steps = howItWorks;
  protected readonly testimonials = testimonials;

  /** "From £49 a month", from the cheapest priced plan. */
  protected readonly fromPrice = (() => {
    const prices = pricing.plans.map((plan) => plan.price).filter((price): price is number => price !== null);
    return prices.length ? pounds.format(Math.min(...prices)) : null;
  })();
  protected readonly vatNote = pricing.vatIncluded ? 'including VAT' : 'excluding VAT';
}
