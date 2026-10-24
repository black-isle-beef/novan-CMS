import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { type Plan, pricing } from '@novan/marketing-content';

const pounds = new Intl.NumberFormat('en-GB', { style: 'currency', currency: pricing.currency, maximumFractionDigits: 0 });

/** One plan: name, price (or "talk to us"), what is included and a call to action naming the plan. */
@Component({
  selector: 'mk-pricing-card',
  imports: [RouterLink],
  templateUrl: './pricing-card.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MkPricingCard {
  readonly plan = input.required<Plan>();

  protected readonly price = computed(() => {
    const price = this.plan().price;
    return price === null ? null : pounds.format(price);
  });
  protected readonly period = pricing.vatIncluded ? 'per month, including VAT' : 'per month, excluding VAT';
  protected readonly headingId = computed(() => `mk-plan-${this.plan().id}`);
}
