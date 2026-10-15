import { reportsRedirect } from './reports-redirect';

const origin = 'https://reports.laws-paws.co.uk';

describe('reportsRedirect', () => {
  it.each([
    ['/report/abc123', `${origin}/report/abc123`],
    ['/report/abc123?utm_source=whatsapp', `${origin}/report/abc123?utm_source=whatsapp`],
    ['/admin', `${origin}/admin`],
    ['/admin/login', `${origin}/admin/login`],
    ['/admin/reports/42', `${origin}/admin/reports/42`],
  ])('sends %s to the reports app', (url, expected) => {
    expect(reportsRedirect(url, origin)).toBe(expected);
  });

  it.each(['/', '/about', '/report', '/report/', '/reports', '/administrator', '/gallery?admin=1'])(
    'leaves the site address %s alone',
    (url) => {
      expect(reportsRedirect(url, origin)).toBeNull();
    },
  );

  it('accepts the origin with a trailing slash', () => {
    expect(reportsRedirect('/admin', `${origin}/`)).toBe(`${origin}/admin`);
  });

  it.each([
    undefined,
    '',
    '  ',
    'http://reports.laws-paws.co.uk',
    'https://reports.laws-paws.co.uk/path',
    'reports.laws-paws.co.uk',
  ])('redirects nothing when REPORTS_ORIGIN is %j', (value) => {
    expect(reportsRedirect('/report/abc123', value)).toBeNull();
  });
});
