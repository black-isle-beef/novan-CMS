import { FALLBACK_SITE_NAME, toSiteContent, withActive } from './site-content';

const entryId = '00000000-0000-4000-8000-000000000001';

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
    expect(toSiteContent(null, null)).toEqual({ siteName: FALLBACK_SITE_NAME, organisationName: FALLBACK_SITE_NAME, nav: [], footer: [] });
    expect(toSiteContent(null, { siteName: 'Paws' }).organisationName).toBe('Paws');
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
