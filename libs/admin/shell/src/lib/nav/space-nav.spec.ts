import { buildSpaceNav } from './space-nav';

const spaceId = '00000000-0000-4000-8000-000000000200';
const base = `/spaces/${spaceId}`;
const labels = (role: string | null, agencyStaff = false) =>
  buildSpaceNav(spaceId, { role, agencyStaff }, base).map((item) => item.label);

describe('buildSpaceNav', () => {
  it('gives a space editor the client menu, with the Forms inbox', () => {
    expect(labels('editor')).toEqual(['Dashboard', 'Pages', 'Media', 'Forms', 'Settings']);
  });

  it.each(['author', 'viewer'])('gives a space %s the client menu without forms, which hold personal data', (role) => {
    expect(labels(role)).toEqual(['Dashboard', 'Pages', 'Media', 'Settings']);
  });

  it('adds the technical screens a developer may use', () => {
    expect(labels('developer')).toEqual(['Dashboard', 'Pages', 'Media', 'Settings', 'Schema', 'API tokens', 'Webhooks']);
  });

  it('gives space admins and agency staff everything', () => {
    const everything = ['Dashboard', 'Pages', 'Media', 'Forms', 'Settings', 'Schema', 'API tokens', 'Webhooks', 'Audit log', 'Space settings'];
    expect(labels('admin')).toEqual(everything);
    expect(labels(null, true)).toEqual(everything);
  });

  it('shows nothing to someone without a role in the space', () => {
    expect(labels(null)).toEqual([]);
  });

  it('links into the space, and marks the most specific section of the address as current', () => {
    const at = (url: string) =>
      buildSpaceNav(spaceId, { role: 'admin', agencyStaff: false }, url)
        .filter((item) => item.active)
        .map((item) => item.label);

    expect(buildSpaceNav(spaceId, { role: 'editor', agencyStaff: false }, base).map((item) => item.href)).toEqual([
      base,
      `${base}/content`,
      `${base}/media`,
      `${base}/forms`,
      `${base}/settings`,
    ]);
    expect(at(base)).toEqual(['Dashboard']);
    expect(at(`${base}/content/00000000-0000-4000-8000-000000000701?x=1`)).toEqual(['Pages']);
    expect(at(`${base}/settings`)).toEqual(['Settings']);
    expect(at(`${base}/members`)).toEqual(['Settings']);
    expect(at(`${base}/settings/api-tokens`)).toEqual(['API tokens']);
    expect(at(`${base}/settings/space`)).toEqual(['Space settings']);
    expect(at('/account')).toEqual([]);
  });

  it('gives every link an icon, hidden from screen readers by the design system', () => {
    expect(buildSpaceNav(spaceId, { role: 'admin', agencyStaff: false }, base).every((item) => item.icon?.startsWith('bi bi-'))).toBe(true);
  });
});
