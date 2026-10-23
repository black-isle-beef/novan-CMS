import type { NovanJsonLd } from '@black-isle-beef/cms-angular';
import { features, site } from '@novan/marketing-content';

/**
 * The home page's structured data: who we are, and what Novan CMS is. Prices are left out until they are confirmed
 * (TODO(pricing)), so search engines are never given placeholder offers.
 */
export function homeJsonLd(origin: string): Record<string, NovanJsonLd> {
  const url = `${origin}/`;
  return {
    organization: {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: site.organisationName,
      url,
      logo: `${origin}/logos/novan-word-white.png`,
      email: site.contactEmail,
    },
    software: {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: site.productName,
      url,
      description: site.tagline,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      featureList: features.filter((feature) => feature.status === 'available').map((feature) => feature.title),
      publisher: { '@type': 'Organization', name: site.organisationName, url },
    },
  };
}
