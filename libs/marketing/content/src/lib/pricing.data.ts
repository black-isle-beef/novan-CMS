import type { SiteLink } from './types';

// TODO(pricing): every plan name, price and limit on this page is a placeholder until the owner confirms them.

export interface Plan {
  id: string;
  name: string;
  /** Whole pounds per billing period, before VAT; `null` for "talk to us". */
  price: number | null;
  billingPeriod: 'month';
  description: string;
  features: readonly string[];
  /** The plan most visitors should look at first. */
  highlighted: boolean;
  cta: SiteLink;
}

/** A value in the comparison table: included, not included, or a limit. */
export type PlanValue = boolean | string;

export interface ComparisonRow {
  feature: string;
  /** By plan id. */
  values: Readonly<Record<string, PlanValue>>;
}

export interface Faq {
  question: string;
  answer: string;
}

export interface Pricing {
  currency: 'GBP';
  /** Whether the prices shown include VAT. */
  vatIncluded: boolean;
  vatNote: string;
  plans: readonly Plan[];
  comparison: readonly ComparisonRow[];
  faq: readonly Faq[];
}

export const pricing: Pricing = {
  currency: 'GBP',
  /** Prices are shown without VAT; the note under the plans says so. */
  vatIncluded: false,
  vatNote: 'All prices are in pounds sterling and exclude VAT, which is added at the current rate.',
  plans: [
    {
      id: 'starter',
      name: 'Starter',
      price: 49,
      billingPeriod: 'month',
      description: 'For a small business with one site and a couple of editors.',
      features: ['One site', 'Up to 3 users', 'Visual page editor', 'Forms inbox', 'Email support'],
      highlighted: false,
      cta: { label: 'Book a demo', path: '/contact', queryParams: { enquiry: 'demo' } },
    },
    {
      id: 'growth',
      name: 'Growth',
      price: 99,
      billingPeriod: 'month',
      description: 'For organisations with a team of editors and content in more than one language.',
      features: ['One site', 'Up to 10 users', 'Review and scheduled publishing', 'Up to 3 languages', 'Webhooks and API access'],
      highlighted: true,
      cta: { label: 'Book a demo', path: '/contact', queryParams: { enquiry: 'demo' } },
    },
    {
      id: 'agency',
      name: 'Agency',
      price: null,
      billingPeriod: 'month',
      description: 'For agencies running many client sites from one place.',
      features: ['Many sites', 'Unlimited users', 'Starter kits and schema as code', 'Priority support'],
      highlighted: false,
      cta: { label: 'Talk to sales', path: '/contact', queryParams: { enquiry: 'sales' } },
    },
  ],
  comparison: [
    { feature: 'Sites', values: { starter: '1', growth: '1', agency: 'Many' } },
    { feature: 'Users', values: { starter: 'Up to 3', growth: 'Up to 10', agency: 'Unlimited' } },
    { feature: 'Visual page editor', values: { starter: true, growth: true, agency: true } },
    { feature: 'Media library', values: { starter: true, growth: true, agency: true } },
    { feature: 'Forms inbox', values: { starter: true, growth: true, agency: true } },
    { feature: 'Review and scheduled publishing', values: { starter: false, growth: true, agency: true } },
    { feature: 'Languages', values: { starter: '1', growth: 'Up to 3', agency: 'Unlimited' } },
    { feature: 'Webhooks and API access', values: { starter: false, growth: true, agency: true } },
    { feature: 'Starter kits and schema as code', values: { starter: false, growth: false, agency: true } },
    { feature: 'Support', values: { starter: 'Email', growth: 'Email', agency: 'Priority' } },
  ],
  // TODO(copy): confirm every answer.
  faq: [
    {
      question: 'Do your prices include VAT?',
      answer: 'No. Prices are shown without VAT, which is added to invoices at the current rate.',
    },
    {
      question: 'Can I change plan later?',
      answer: 'Yes. Move up or down a plan whenever you need to; the change applies from your next billing date.',
    },
    {
      question: 'Who builds my site?',
      answer: 'We do. We design and build your site on the Novan Design System, then hand you the keys to edit it.',
    },
    {
      question: 'Who owns my content?',
      answer: 'You do. You can export your content through the API whenever you like.',
    },
    {
      question: 'Where is my data stored?',
      answer: 'Content and accounts are stored with Supabase. See our privacy policy for the full list of providers we use.',
    },
    {
      question: 'Is there a contract?',
      answer: 'Plans are billed monthly. Talk to us about the notice period before you sign up.',
    },
  ],
};
