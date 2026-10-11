import { deliveryEntriesQuerySchema } from './delivery';
import { adminSearchQuerySchema, searchTerms, SNIPPET_START as S, SNIPPET_STOP as E, snippetParts, tsQueryOf } from './search';

describe('search terms', () => {
  it('keeps letters and digits, lower-cased', () => {
    expect(searchTerms('  Café opening-hours 2026!  ')).toEqual(['café', 'opening', 'hours', '2026']);
  });

  it('builds a query where every word must match and the last may be unfinished', () => {
    expect(tsQueryOf('garden tou')).toBe('garden & tou:*');
    expect(tsQueryOf('roses')).toBe('roses:*');
  });

  it('never lets query syntax through', () => {
    expect(tsQueryOf("a' | b:* & !c (d)")).toBe('a & b & c & d:*');
    expect(tsQueryOf('&&& !!!')).toBeNull();
  });

  it('uses at most eight words', () => {
    expect(searchTerms('a b c d e f g h i j')).toHaveLength(8);
  });
});

describe('snippetParts', () => {
  it('splits a marked snippet into plain and matching parts', () => {
    expect(snippetParts(`Roses ${S}bloom${E} in June, ${S}bloom${E}ing`)).toEqual([
      { text: 'Roses ', match: false },
      { text: 'bloom', match: true },
      { text: ' in June, ', match: false },
      { text: 'bloom', match: true },
      { text: 'ing', match: false },
    ]);
  });

  it('keeps text as text, never markup', () => {
    expect(snippetParts(`<script>${S}x${E}</script>`)).toEqual([
      { text: '<script>', match: false },
      { text: 'x', match: true },
      { text: '</script>', match: false },
    ]);
  });

  it('copes with unclosed marks and extra space', () => {
    expect(snippetParts(`a  \n b ${S}c`)).toEqual([
      { text: 'a b ', match: false },
      { text: 'c', match: true },
    ]);
    expect(snippetParts('')).toEqual([]);
  });
});

describe('q on GET entries', () => {
  const parse = (query: Record<string, unknown>) => deliveryEntriesQuerySchema.safeParse(query);

  it('sorts search results by relevance', () => {
    expect(parse({ q: 'roses' }).data).toMatchObject({ q: 'roses', sort: 'relevance' });
    expect(parse({ q: 'roses', type: 'page', sort: 'relevance' }).success).toBe(true);
  });

  it('keeps -updatedAt as the default without q', () => {
    expect(parse({}).data).toMatchObject({ sort: '-updatedAt' });
  });

  it('refuses relevance without q, other sorts and field filters with q', () => {
    expect(parse({ sort: 'relevance' }).success).toBe(false);
    expect(parse({ q: 'roses', sort: '-updatedAt' }).success).toBe(false);
    expect(parse({ q: 'roses', type: 'page', 'fields.title': 'x' }).success).toBe(false);
  });

  it('needs a word to search for', () => {
    expect(parse({ q: '!!!' }).success).toBe(false);
    expect(parse({ q: 'x'.repeat(201) }).success).toBe(false);
  });
});

describe('admin search query', () => {
  it('defaults to the main environment and six of each kind', () => {
    expect(adminSearchQuerySchema.parse({ q: ' home ' })).toEqual({ q: 'home', environment: 'main', limit: 6 });
  });

  it('needs letters or numbers', () => {
    expect(adminSearchQuerySchema.safeParse({ q: '...' }).success).toBe(false);
  });
});
