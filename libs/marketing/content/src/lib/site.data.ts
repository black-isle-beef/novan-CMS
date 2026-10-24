import type { PageMeta, SiteLink } from './types';

/** Facts about the business, used in the header, footer, legal pages and structured data. */
export const site = {
  productName: 'Novan CMS',
  // TODO(copy): confirm the legal entity name, its address and its ICO registration number.
  organisationName: 'Novan Web Services',
  legalAddress: null as string | null,
  icoRegistration: null as string | null,
  tagline: 'A simple CMS, so your clients can manage their own sites.',
  // TODO(copy): confirm the public enquiries address.
  contactEmail: 'hello@novan.example',
  // TODO(copy): how quickly enquiries are answered.
  responseTime: 'We aim to reply within two working days.',
} as const;

export interface Testimonial {
  quote: string;
  name: string;
  role: string;
}

/**
 * Quotes from real clients, with their permission. The home page shows the section only when there is at least one.
 * TODO(copy): add testimonials once clients have agreed to be quoted; never invent them.
 */
export const testimonials: readonly Testimonial[] = [];

/** The header's links, in order. */
export const primaryNav: readonly SiteLink[] = [
  { label: 'Home', path: '/' },
  { label: 'Features', path: '/features' },
  { label: 'Pricing', path: '/pricing' },
  { label: 'Contact', path: '/contact' },
];

/** The brushed-copper call to action in the header and closing bands. */
export const primaryCta: SiteLink = { label: 'Book a demo', path: '/contact', queryParams: { enquiry: 'demo' } };

/** Label of the link to the CMS admin's sign-in page (`CMS_LOGIN_URL`); the admin calls the page "Sign in". */
export const signInLabel = 'Sign in';

/** The footer's link columns. */
export const footerLinks: readonly { title: string; links: readonly SiteLink[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'Features', path: '/features' },
      { label: 'Pricing', path: '/pricing' },
      { label: 'Contact', path: '/contact' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy policy', path: '/privacy' },
      { label: 'Cookie policy', path: '/cookies' },
      { label: 'Accessibility statement', path: '/accessibility' },
    ],
  },
];

/** Pages listed in sitemap.xml, with their meta. The 404 page is left out on purpose. */
export const pages = {
  home: {
    path: '/',
    title: 'Novan CMS: a simple CMS your clients can run themselves',
    description:
      'Novan CMS gives your clients a visual editor for their own website, built on an accessible design system, with fast, search-friendly pages.',
  },
  features: {
    path: '/features',
    title: 'Features',
    description:
      'A visual page editor, reusable blocks, a media library, roles and permissions, and a headless API: what Novan CMS does and how.',
  },
  pricing: {
    path: '/pricing',
    title: 'Pricing',
    description: 'Novan CMS plans and prices in pounds sterling, with a side-by-side comparison and answers to common questions.',
  },
  contact: {
    path: '/contact',
    title: 'Contact us',
    description: 'Ask a question, talk to sales, get support or book a demo of Novan CMS.',
  },
  privacy: {
    path: '/privacy',
    title: 'Privacy policy',
    description: 'How Novan Web Services collects, uses and protects personal data on this website.',
  },
  cookies: {
    path: '/cookies',
    title: 'Cookie policy',
    description: 'The cookies this website uses, why, and how to change your choices.',
  },
  accessibility: {
    path: '/accessibility',
    title: 'Accessibility statement',
    description: 'How accessible this website is, known issues and how to report a problem.',
  },
} as const satisfies Record<string, PageMeta & { path: string }>;

export type PageKey = keyof typeof pages;

/** Meta for the branded not-found page (never in the sitemap). */
export const notFoundPage: PageMeta = {
  title: 'Page not found',
  description: 'We could not find that page.',
};
