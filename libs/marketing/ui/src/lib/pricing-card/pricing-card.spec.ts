import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Plan } from '@novan/marketing-content';
import axe from 'axe-core';
import { MkPricingCard } from './pricing-card';

const plan: Plan = {
  id: 'growth',
  name: 'Growth',
  price: 99,
  billingPeriod: 'month',
  description: 'For teams.',
  features: ['Up to 10 users', 'Webhooks'],
  highlighted: true,
  cta: { label: 'Book a demo', path: '/contact', queryParams: { enquiry: 'demo' } },
};

function render(value: Plan) {
  TestBed.configureTestingModule({ imports: [MkPricingCard], providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(MkPricingCard);
  fixture.componentRef.setInput('plan', value);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('MkPricingCard', () => {
  it('shows the price in pounds, without VAT, and names the plan in its call to action', () => {
    const host = render(plan);

    expect(host.querySelector('.mk-plan__amount')?.textContent?.trim()).toBe('£99');
    expect(host.querySelector('.mk-plan__period')?.textContent?.trim()).toBe('per month, excluding VAT');
    expect(host.querySelector('.mk-plan__flag')?.textContent?.trim()).toBe('Most popular');
    const cta = host.querySelector<HTMLAnchorElement>('a.mk-plan__cta')!;
    expect(cta.textContent?.replace(/\s+/g, ' ').trim()).toBe('Book a demo: Growth plan');
    expect(cta.getAttribute('href')).toBe('/contact?enquiry=demo');
    expect(cta.classList).toContain('btn-primary');
  });

  it('says "Let’s talk" for a plan without a price', () => {
    const host = render({ ...plan, price: null, highlighted: false });

    expect(host.querySelector('.mk-plan__amount')?.textContent?.trim()).toBe('Let’s talk');
    expect(host.querySelector('.mk-plan__flag')).toBeNull();
    expect(host.querySelector('a.mk-plan__cta')?.classList).toContain('btn-secondary');
  });

  it('has no axe violations', async () => {
    const host = render(plan);
    const results = await axe.run(host, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
