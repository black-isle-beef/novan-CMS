import { novanImage } from './image';
import { novanLinkHref, resolveHref } from './links';

describe('novanLinkHref', () => {
  it('turns link field values into addresses', () => {
    expect(novanLinkHref({ type: 'internal', entryId: 'e', path: '/about' })).toBe('/about');
    expect(novanLinkHref({ type: 'internal', entryId: 'e', path: '/about', anchor: 'team' })).toBe('/about#team');
    expect(novanLinkHref({ type: 'external', url: 'https://example.com' })).toBe('https://example.com');
    expect(novanLinkHref({ type: 'email', email: 'hi@example.com' })).toBe('mailto:hi@example.com');
  });

  it('gives null for unpublished pages, unsafe or malformed links', () => {
    expect(novanLinkHref({ type: 'internal', entryId: 'e', path: null })).toBeNull();
    expect(novanLinkHref({ type: 'internal', entryId: 'e' })).toBeNull();
    expect(novanLinkHref({ type: 'external', url: 'javascript:alert(1)' })).toBeNull();
    expect(novanLinkHref({ type: 'external', url: 'mailto:a@b.c' })).toBeNull();
    expect(novanLinkHref({ type: 'email', email: 'not an email' })).toBeNull();
    expect(novanLinkHref({ type: 'other' } as never)).toBeNull();
    expect(novanLinkHref(null)).toBeNull();
  });
});

describe('resolveHref', () => {
  it('splits site paths for the router', () => {
    expect(resolveHref('/blog/post?page=2&q=a%20b#comments')).toEqual({
      internal: true,
      href: '/blog/post?page=2&q=a%20b#comments',
      path: '/blog/post',
      queryParams: { page: '2', q: 'a b' },
      fragment: 'comments',
    });
    expect(resolveHref('#top')).toEqual({ internal: false, href: '#top' });
    expect(resolveHref('tel:+441234')).toEqual({ internal: false, href: 'tel:+441234' });
  });
});

describe('novanImage', () => {
  const asset = { url: 'https://api.example.com/v1/assets/a1/photo.jpg?v=3' };

  it('adds resize options to the image route', () => {
    expect(novanImage(asset, { width: 1200, height: 600, fit: 'cover', quality: 80 })).toBe(
      'https://api.example.com/v1/assets/a1/photo.jpg?v=3&width=1200&height=600&resize=cover&quality=80',
    );
    expect(novanImage(asset)).toBe(asset.url);
  });

  it('keeps sizes in the range the API takes', () => {
    expect(novanImage(asset, { width: 9999, height: 0.4, quality: 5 })).toBe(
      'https://api.example.com/v1/assets/a1/photo.jpg?v=3&width=2500&height=1&quality=20',
    );
  });

  it('keeps relative image route URLs relative', () => {
    expect(novanImage({ url: '/v1/assets/a1/photo.jpg?v=1' }, { width: 100 })).toBe('/v1/assets/a1/photo.jpg?v=1&width=100');
  });

  it('leaves signed preview URLs alone and gives an empty string for no image', () => {
    const signed = { url: 'https://xyz.supabase.co/storage/v1/object/sign/media/spaces/s/a/photo.jpg?token=abc' };
    expect(novanImage(signed, { width: 100 })).toBe(signed.url);
    expect(novanImage(null)).toBe('');
    expect(novanImage(undefined, { width: 10 })).toBe('');
  });
});
