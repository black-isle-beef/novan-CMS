import {
  createRedirectRequestSchema,
  isRedirectTarget,
  normaliseSitePath,
  notFoundReportSchema,
  parseRedirectsCsv,
  redirectsCsv,
  updateRedirectRequestSchema,
} from './site';

describe('redirect addresses', () => {
  it.each([
    ['/old-page', '/old-page'],
    ['  /old-page/  ', '/old-page'],
    ['/', '/'],
    ['//', '/'],
    ['/blog/post?id=3#top', '/blog/post'],
    ['https://old.example.com/about-us/', '/about-us'],
    ['http://old.example.com', '/'],
  ])('reads %j as %j', (input, expected) => {
    expect(normaliseSitePath(input)).toBe(expected);
  });

  it.each(['old-page', '/with space', 'ftp://example.com/x', '', `/${'a'.repeat(1024)}`])('has no path in %j', (input) => {
    expect(normaliseSitePath(input)).toBeNull();
  });

  it('goes to a path on the site or an http(s) address, and nowhere else', () => {
    expect(isRedirectTarget('/about')).toBe(true);
    expect(isRedirectTarget('/search?q=shoes#results')).toBe(true);
    expect(isRedirectTarget('https://example.com/x')).toBe(true);
    expect(isRedirectTarget('//evil.example.com')).toBe(false);
    expect(isRedirectTarget('javascript:alert(1)')).toBe(false);
    expect(isRedirectTarget('about')).toBe(false);
    expect(isRedirectTarget('/a b')).toBe(false);
  });

  it('defaults to a permanent redirect and refuses one to the same address', () => {
    expect(createRedirectRequestSchema.parse({ fromPath: '/old/', toPath: '/new' })).toEqual({ fromPath: '/old', toPath: '/new', status: 301 });
    expect(createRedirectRequestSchema.safeParse({ fromPath: '/same/', toPath: '/same' }).success).toBe(false);
    expect(createRedirectRequestSchema.safeParse({ fromPath: '/a', toPath: '/b', status: 307 }).success).toBe(false);
  });

  it('changes at least one thing', () => {
    expect(updateRedirectRequestSchema.safeParse({}).success).toBe(false);
    expect(updateRedirectRequestSchema.parse({ status: 302 })).toEqual({ status: 302 });
  });
});

describe('redirects CSV', () => {
  it('reads from, to and status, skipping a header and blank lines', () => {
    const { redirects, problems } = parseRedirectsCsv('Old URL,New URL,Status\r\n/old,/new,302\r\n\r\nhttps://old.example.com/team/,/about\r\n');

    expect(problems).toEqual([]);
    expect(redirects).toEqual([
      { fromPath: '/old', toPath: '/new', status: 302 },
      { fromPath: '/team', toPath: '/about', status: 301 },
    ]);
  });

  it('takes semicolons and quoted cells', () => {
    const { redirects } = parseRedirectsCsv('/a;"/b?x=1;y=2"\n"/c";"https://example.com/""quoted"""');

    expect(redirects).toEqual([
      { fromPath: '/a', toPath: '/b?x=1;y=2', status: 301 },
      { fromPath: '/c', toPath: 'https://example.com/"quoted"', status: 301 },
    ]);
  });

  it('reports the lines it cannot use, and the later of two lines from one address wins', () => {
    const { redirects, problems } = parseRedirectsCsv('from,to\n/a,/b\nnot-a-path,/c\n/d,/e,307\n/a,/z');

    expect(redirects).toEqual([{ fromPath: '/a', toPath: '/z', status: 301 }]);
    expect(problems).toEqual([
      { line: 3, message: 'Enter an address on this site starting with /, for example /old-page.' },
      { line: 4, message: 'The status must be 301 (permanent) or 302 (temporary).' },
    ]);
  });

  it('writes what it reads', () => {
    const rows = [
      { fromPath: '/a', toPath: '/b?x=1,2', status: 301 as const },
      { fromPath: '/c', toPath: 'https://example.com/', status: 302 as const },
    ];

    expect(parseRedirectsCsv(redirectsCsv(rows))).toEqual({ redirects: rows, problems: [] });
  });
});

describe('not-found reports', () => {
  it('keep the path and an http(s) referrer only', () => {
    expect(notFoundReportSchema.parse({ path: '/missing/?utm=x', referrer: 'https://google.com/' })).toEqual({
      path: '/missing',
      referrer: 'https://google.com/',
    });
    expect(notFoundReportSchema.parse({ path: '/missing', referrer: 'android-app://x' })).toEqual({ path: '/missing', referrer: null });
    expect(notFoundReportSchema.safeParse({ path: 'missing' }).success).toBe(false);
  });
});
