import {
  createApiTokenRequestSchema,
  deliveryEntriesQuerySchema,
  deliveryPageQuerySchema,
  deliveryPathSchema,
} from './delivery';

describe('delivery queries', () => {
  it('accepts / and folder paths, ignoring a trailing slash', () => {
    expect(deliveryPathSchema.parse('/')).toBe('/');
    expect(deliveryPathSchema.parse('/blog/hello-world/')).toBe('/blog/hello-world');
    for (const bad of ['', 'about', '/About', '/a//b', '/../etc', '/a b', "/a'"]) {
      expect(deliveryPathSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('defaults include to 1 and allows 0 to 3', () => {
    expect(deliveryPageQuerySchema.parse({ path: '/' })).toEqual({ path: '/', include: 1 });
    expect(deliveryPageQuerySchema.parse({ path: '/', include: '0' }).include).toBe(0);
    expect(deliveryPageQuerySchema.safeParse({ path: '/', include: '4' }).success).toBe(false);
    expect(deliveryPageQuerySchema.safeParse({ path: '/', other: 'x' }).success).toBe(false);
  });

  it('turns select into field names', () => {
    expect(deliveryPageQuerySchema.parse({ path: '/', select: 'fields.title, fields.image,fields.title' }).select).toEqual([
      'title',
      'image',
    ]);
    expect(deliveryPageQuerySchema.safeParse({ path: '/', select: 'title' }).success).toBe(false);
  });

  it('reads field filters as Express parses them', () => {
    const query = deliveryEntriesQuerySchema.parse({
      type: 'article',
      'fields.category': 'news',
      'fields.rating': { gt: '3', lt: '5' },
      'fields.tags': { in: 'a,b' },
      limit: '10',
    });
    expect(query).toMatchObject({ type: 'article', limit: 10, sort: '-updatedAt', include: 1 });
    expect(query.filters).toEqual([
      { field: 'category', op: 'eq', value: 'news' },
      { field: 'rating', op: 'gt', value: '3' },
      { field: 'rating', op: 'lt', value: '5' },
      { field: 'tags', op: 'in', value: ['a', 'b'] },
    ]);
  });

  it("reads Express's simple query parser too, which keeps the brackets in the key", () => {
    const query = deliveryEntriesQuerySchema.parse({ type: 'post', 'fields.rating[gt]': '3', 'fields.tags[in]': 'a,b' });
    expect(query.filters).toEqual([
      { field: 'rating', op: 'gt', value: '3' },
      { field: 'tags', op: 'in', value: ['a', 'b'] },
    ]);
    const issues = deliveryEntriesQuerySchema.safeParse({ type: 'post', 'fields.title[like]': '%', 'fields.title[eq]': ['a', 'b'] }).error?.issues;
    expect(issues?.map((issue) => issue.message)).toEqual(['Use eq, in, lt or gt.', 'Give this filter once, with up to 500 characters.']);
  });

  it('refuses unknown parameters and operators, repeated filters, and field filters without a type', () => {
    const issues = (query: Record<string, unknown>) =>
      deliveryEntriesQuerySchema.safeParse(query).error?.issues.map((issue) => issue.path.join('.'));
    expect(issues({ spaceId: 'x' })).toEqual(['spaceId']);
    expect(issues({ type: 'a', 'fields.title': { like: '%' } })).toEqual(['fields.title.like']);
    expect(issues({ type: 'a', 'fields.title': ['a', 'b'] })).toEqual(['fields.title']);
    expect(issues({ 'fields.title': 'a' })).toEqual(['type']);
    expect(issues({ sort: 'fields.title' })).toEqual(['type']);
    expect(issues({ 'fields.bad-name': 'a', type: 'a' })).toEqual(['fields.bad-name']);
    expect(issues({ limit: '101' })).toEqual(['limit']);
    expect(issues({ sort: 'createdAt' })).toEqual(['sort']);
  });
});

describe('createApiTokenRequestSchema', () => {
  it('defaults to the main environment', () => {
    expect(createApiTokenRequestSchema.parse({ name: ' Website ', scope: 'delivery' })).toEqual({
      name: 'Website',
      scope: 'delivery',
      environment: 'main',
    });
    expect(createApiTokenRequestSchema.safeParse({ name: 'x', scope: 'management' }).success).toBe(false);
  });
});
