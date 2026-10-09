import type { NovanAsset } from '@black-isle-beef/cms-angular';
import { FALLBACK_SITE_NAME, toSiteContent, withActive } from './site-content';

const entryId = '00000000-0000-4000-8000-000000000001';

const asset = (id: string, url = `https://api.example.com/v1/assets/${id}/file.png?v=1`): NovanAsset => ({
  id,
  url,
  filename: 'file.png',
  mime: 'image/png',
  width: 400,
  height: 100,
  alt: null,
  focal: null,
});

const none = { logo: null, faviconUrl: null, shareImage: null, contact: { email: null, phone: null, address: null }, social: [], analyticsId: null };

describe('toSiteContent', () => {
  it('builds the header menu and footer links from the navigation singleton', () => {
    const site = toSiteContent(
      {
        items: [
          { label: 'Home', link: { type: 'internal', entryId, path: '/' } },
          {
            label: 'Services',
            subItems: [
              { label: 'Grooming', link: { type: 'internal', entryId, path: '/services/grooming' } },
              { label: 'Unpublished', link: { type: 'internal', entryId, path: null } },
            ],
          },
          { label: 'Blog', link: { type: 'external', url: 'https://blog.example.com' } },
        ],
        footerGroups: [{ title: 'Contact', links: [{ label: 'Email', link: { type: 'email', email: 'hi@example.com' } }] }],
      },
      { siteName: 'Paws', organisationName: 'Paws Ltd' },
    );

    expect(site).toEqual({
      siteName: 'Paws',
      organisationName: 'Paws Ltd',
      nav: [
        { label: 'Home', href: '/' },
        { label: 'Services', href: '', children: [{ label: 'Grooming', href: '/services/grooming' }] },
        { label: 'Blog', href: 'https://blog.example.com' },
      ],
      footer: [{ title: 'Contact', links: [{ label: 'Email', href: 'mailto:hi@example.com' }] }],
      ...none,
      settings: { siteName: 'Paws', organisationName: 'Paws Ltd' },
    });
  });

  it('drops items with nowhere to go, unsafe links and empty groups', () => {
    const site = toSiteContent(
      {
        items: [
          { label: 'Gone', link: { type: 'internal', entryId, path: null } },
          { label: 'Bad', link: { type: 'external', url: 'javascript:alert(1)' } },
          { label: '  ', link: { type: 'internal', entryId, path: '/x' } },
          null as never,
        ],
        footerGroups: [{ title: 'Empty', links: [] }, { title: '', links: [{ label: 'x', link: { type: 'internal', entryId, path: '/x' } }] }],
      },
      null,
    );

    expect(site.nav).toEqual([]);
    expect(site.footer).toEqual([]);
  });

  it('falls back when the singletons are missing', () => {
    expect(toSiteContent(null, null)).toEqual({ siteName: FALLBACK_SITE_NAME, organisationName: FALLBACK_SITE_NAME, nav: [], footer: [], ...none, settings: null });
    expect(toSiteContent(null, { siteName: 'Paws' }).organisationName).toBe('Paws');
  });
});

describe('site settings', () => {
  it('give the logo, icon, sharing image, contact details, social links and analytics ID', () => {
    const site = toSiteContent(null, {
      siteName: 'Paws',
      logo: asset('logo'),
      favicon: asset('icon'),
      defaultOgImage: asset('share'),
      contact: { email: ' hi@paws.test ', phone: '+44 1234 567890', address: '1 Bark Lane\nDogtown' },
      socialLinks: [
        { network: 'instagram', url: 'https://instagram.com/paws' },
        { network: 'other', url: 'https://www.mastodon.example/@paws' },
        { network: 'x', url: 'http://insecure.example' },
        { network: 'facebook', url: 'javascript:alert(1)' },
      ],
      analyticsId: 'G-ABC123XYZ',
    });

    expect(site).toMatchObject({
      logo: { id: 'logo' },
      faviconUrl: 'https://api.example.com/v1/assets/icon/file.png?v=1',
      shareImage: { id: 'share' },
      contact: { email: 'hi@paws.test', phone: '+44 1234 567890', address: '1 Bark Lane\nDogtown' },
      social: [
        { label: 'Instagram', href: 'https://instagram.com/paws' },
        { label: 'mastodon.example', href: 'https://www.mastodon.example/@paws' },
      ],
      analyticsId: 'G-ABC123XYZ',
    });
  });

  it('ignore images without a usable address and a malformed analytics ID', () => {
    const site = toSiteContent(null, { logo: asset('logo', 'javascript:x'), analyticsId: 'UA-1234-1' });

    expect(site.logo).toBeNull();
    expect(site.analyticsId).toBeNull();
  });
});

describe('withActive', () => {
  it('marks the item for the current path only', () => {
    const items = [
      { label: 'Home', href: '/' },
      { label: 'About', href: '/about' },
    ];

    expect(withActive(items, '/about').map((item) => item.active)).toEqual([false, true]);
  });
});
