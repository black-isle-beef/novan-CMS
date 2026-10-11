import { z } from 'zod';

// Search (docs/build/18-search-forms-audit.md): `q` on the Delivery and Preview APIs' `GET entries`, and the admin's
// global search (`GET /v1/management/spaces/:spaceId/search`).

/** At most this many words of a search are used. */
export const MAX_SEARCH_TERMS = 8;
export const MAX_SEARCH_LENGTH = 200;

/** The words of a search: letters and digits, lower-cased, at most {@link MAX_SEARCH_TERMS}. */
export function searchTerms(q: string): string[] {
  return (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map((word) => word.slice(0, 50)).slice(0, MAX_SEARCH_TERMS);
}

/**
 * A Postgres `to_tsquery` for the words of `q`: every word must match, and the last may be the start of a word, so
 * results appear as people type (`garden tou` finds "Garden tours"). Only letters and digits reach the query, so it
 * cannot be malformed. Null when `q` has no words.
 */
export function tsQueryOf(q: string): string | null {
  const terms = searchTerms(q);
  if (!terms.length) return null;
  return terms.map((term, index) => (index === terms.length - 1 ? `${term}:*` : term)).join(' & ');
}

/** One stretch of a snippet; `match` marks the words that matched the search, for highlighting. */
export interface SearchSnippetPart {
  text: string;
  match: boolean;
}

export const searchSnippetSchema = z.array(z.object({ text: z.string(), match: z.boolean() }));

/** Marks the search engine puts around matched words in a snippet: private-use characters no content contains. */
export const SNIPPET_START = '\uE000';
export const SNIPPET_STOP = '\uE001';

/** A snippet marked with {@link SNIPPET_START} and {@link SNIPPET_STOP}, as plain text parts (never HTML). */
export function snippetParts(marked: string): SearchSnippetPart[] {
  const parts: SearchSnippetPart[] = [];
  const push = (text: string, match: boolean) => {
    const clean = text.replace(/[\uE000\uE001]/g, '');
    if (!clean) return;
    const last = parts[parts.length - 1];
    if (last && last.match === match) last.text += clean;
    else parts.push({ text: clean, match });
  };
  let rest = marked.replace(/\s+/g, ' ').trim();
  while (rest) {
    const start = rest.indexOf(SNIPPET_START);
    if (start < 0) {
      push(rest, false);
      break;
    }
    push(rest.slice(0, start), false);
    const stop = rest.indexOf(SNIPPET_STOP, start + 1);
    push(rest.slice(start + 1, stop < 0 ? undefined : stop), true);
    rest = stop < 0 ? '' : rest.slice(stop + 1);
  }
  return parts;
}

/** What `q` adds to each delivered entry. */
export interface DeliverySearchInfo {
  /** Relevance: higher is better. Only comparable within one search. */
  rank: number;
  /** A short passage of the entry's text in the requested locale, with the matching words marked. */
  snippet: SearchSnippetPart[];
}

export const deliverySearchInfoSchema: z.ZodType<DeliverySearchInfo> = z.object({ rank: z.number(), snippet: searchSnippetSchema });

// --- Admin search -------------------------------------------------------------------------------

export const adminSearchQuerySchema = z.strictObject({
  q: z
    .string()
    .trim()
    .min(1, 'Type something to search for.')
    .max(MAX_SEARCH_LENGTH)
    .refine((q) => searchTerms(q).length > 0, 'Search with letters or numbers.'),
  environment: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use an environment name like main.')
    .default('main'),
  /** Results of each kind, 1 to 20. */
  limit: z.coerce.number().int().min(1).max(20).default(6),
});
export type AdminSearchQuery = z.input<typeof adminSearchQuerySchema>;

export const adminSearchKinds = ['page', 'entry', 'media'] as const;
export type AdminSearchKind = (typeof adminSearchKinds)[number];

export const adminSearchHitSchema = z.object({
  kind: z.enum(adminSearchKinds),
  id: z.uuid(),
  title: z.string(),
  /** A page's address, an entry's content type, or a file's name. */
  detail: z.string(),
  /** Pages and entries: draft, in_review, scheduled, published or archived. */
  status: z.string().nullable(),
});
export type AdminSearchHit = z.infer<typeof adminSearchHitSchema>;

export const adminSearchResultsSchema = z.object({
  pages: z.array(adminSearchHitSchema),
  entries: z.array(adminSearchHitSchema),
  media: z.array(adminSearchHitSchema),
});
export type AdminSearchResults = z.infer<typeof adminSearchResultsSchema>;
