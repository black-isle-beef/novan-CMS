import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  DsFooterComponent,
  DsHeaderComponent,
  DsHeroComponent,
  type FooterLinkGroup,
  type NavItem,
} from '@black-isle-beef/novan-design-system';

interface Feature {
  /** Bootstrap Icons class name(s), e.g. `'bi bi-diagram-3'`. */
  icon: string;
  title: string;
  description: string;
}

interface Step {
  title: string;
  description: string;
}

/**
 * Public landing page for Novan CMS. Composed from design-system components
 * (`ds-header`, `ds-hero`, `ds-footer`); the sections in between reuse the
 * design system's global `ds-landing-page__*` styles.
 */
@Component({
  selector: 'app-landing-page',
  imports: [DsHeaderComponent, DsHeroComponent, DsFooterComponent],
  templateUrl: './landing-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ds-landing-page',
  },
})
export class LandingPage {
  protected readonly navItems: NavItem[] = [
    { label: 'Features', href: '#features' },
    { label: 'How it works', href: '#how-it-works' },
    { label: 'Get started', href: '#get-started' },
  ];

  protected readonly features: Feature[] = [
    {
      icon: 'bi bi-diagram-3',
      title: 'Structured content',
      description: 'Model pages, articles and reusable blocks as typed content so every channel gets clean, predictable data.',
    },
    {
      icon: 'bi bi-pencil-square',
      title: 'Friendly editing',
      description: 'Editors draft, preview and update content without waiting on a developer or a deployment.',
    },
    {
      icon: 'bi bi-check2-circle',
      title: 'Review and publish',
      description: 'Move content from draft to review to live, with clear ownership at every step.',
    },
    {
      icon: 'bi bi-plug',
      title: 'Deliver anywhere',
      description: 'Serve published content to websites and apps through a single delivery API.',
    },
  ];

  protected readonly steps: Step[] = [
    {
      title: 'Model your content',
      description: 'Define the content types your site needs, from landing pages to blog posts.',
    },
    {
      title: 'Create and collaborate',
      description: 'Your team writes and reviews content in one place, styled by the Novan design system.',
    },
    {
      title: 'Publish everywhere',
      description: 'Go live in a click and deliver the same content to every channel you run.',
    },
  ];

  protected readonly footerLinkGroups: FooterLinkGroup[] = [
    {
      title: 'Product',
      links: [
        { label: 'Features', href: '#features' },
        { label: 'How it works', href: '#how-it-works' },
        { label: 'Get started', href: '#get-started' },
      ],
    },
  ];
}
