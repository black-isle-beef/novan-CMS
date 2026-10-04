import { cacheTags, entryPath, lastSegment } from './paths';

describe('paths', () => {
  it('joins a folder path and a slug', () => {
    expect(entryPath('/blog/news', 'hello')).toBe('/blog/news/hello');
    expect(entryPath(null, 'home')).toBe('/home');
  });

  it('takes the last part of an address', () => {
    expect(lastSegment('/blog/news/hello')).toBe('hello');
    expect(lastSegment('/home')).toBe('home');
  });

  it('tags a published entry by id, and by type within its environment', () => {
    expect(cacheTags({ id: 'e1', environmentId: 'env1', contentType: 'page' })).toEqual(['entry:e1', 'type:env1:page']);
  });
});
