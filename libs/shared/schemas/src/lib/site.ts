import { z } from 'zod';

// Redirects and the addresses visitors found no page at (docs/build/14-seo-site-features.md). Managed under
// /v1/management/spaces/:spaceId/redirects and .../not-found; client sites read redirects from
// GET /v1/delivery/redirects and report misses to POST /v1/delivery/not-found.

// --- Paths --------------------------------------------------------------------------------------

/** Longest address a redirect starts from, or a miss is recorded at (0012_seo_site.sql). */
export const MAX_SITE_PATH = 1024;
export const MAX_REDIRECT_TARGET = 2048;

/**
 * An address on the site as redirects store it: a path starting `/`, without a query, fragment or trailing slash
 * (but `/` itself). A whole URL gives its path, so addresses copied from an old site's pages work too. Null when
 * there is no usable path.
 */
export function normaliseSitePath(value: string): string | null {
  let path = value.trim();
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  }
  path = path.split(/[?#]/, 1)[0];
  if (!path.startsWith('/') || /\s/.test(path)) return null;
  path = path.replace(/\/+$/, '') || '/';
  return path.length <= MAX_SITE_PATH ? path : null;
}

/** Where a redirect goes: another address on the site (with a query or fragment if wanted) or an http(s) URL. */
export function isRedirectTarget(value: string): boolean {
  if (value.length > MAX_REDIRECT_TARGET || /\s/.test(value)) return false;
  if (value.startsWith('/')) return !value.startsWith('//');
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && /^https?:\/\/[^/]/i.test(value);
  } catch {
    return false;
  }
}

const fromPathSchema = z
  .string()
  .trim()
  .min(1, 'Enter the old address, for example /old-page.')
  .transform((value, ctx) => {
    const path = normaliseSitePath(value);
    if (!path) {
      ctx.addIssue({ code: 'custom', message: 'Enter an address on this site starting with /, for example /old-page.' });
      return z.NEVER;
    }
    return path;
  });

const toPathSchema = z
  .string()
  .trim()
  .min(1, 'Enter where it should go.')
  .refine(isRedirectTarget, 'Enter an address on this site starting with /, or a full web address starting with https://.');

export const redirectStatuses = [301, 302] as const;
export const redirectStatusSchema = z.union([z.literal(301), z.literal(302)]);
export type RedirectStatus = z.infer<typeof redirectStatusSchema>;

// --- Management ---------------------------------------------------------------------------------

export const redirectSchema = z.object({
  id: z.uuid(),
  fromPath: z.string(),
  toPath: z.string(),
  status: redirectStatusSchema,
  /** Made by the CMS when a published page's address changed, rather than by a person. */
  automatic: z.boolean(),
  createdBy: z.uuid().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Redirect = z.infer<typeof redirectSchema>;

export const createRedirectRequestSchema = z
  .strictObject({
    fromPath: fromPathSchema,
    toPath: toPathSchema,
    status: redirectStatusSchema.default(301),
  })
  .refine((value) => value.fromPath !== value.toPath, { message: 'A redirect cannot go to the same address.', path: ['toPath'] });
export type CreateRedirectRequest = z.input<typeof createRedirectRequestSchema>;

export const updateRedirectRequestSchema = z
  .strictObject({
    fromPath: fromPathSchema.optional(),
    toPath: toPathSchema.optional(),
    status: redirectStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Change at least one thing.');
export type UpdateRedirectRequest = z.input<typeof updateRedirectRequestSchema>;

/** At most this many redirects in one import. */
export const MAX_REDIRECT_IMPORT = 5000;

/** Redirects from a CSV file, parsed (and checked) in the admin first. Existing redirects from the same address are replaced. */
export const importRedirectsRequestSchema = z.strictObject({
  redirects: z
    .array(createRedirectRequestSchema)
    .min(1, 'There are no redirects to import.')
    .max(MAX_REDIRECT_IMPORT, `Import up to ${MAX_REDIRECT_IMPORT} redirects at a time.`),
});
export type ImportRedirectsRequest = z.input<typeof importRedirectsRequestSchema>;

export const importRedirectsResultSchema = z.object({
  created: z.int(),
  updated: z.int(),
  /** Redirects left out, such as one from the address of a published page. */
  skipped: z.array(z.object({ fromPath: z.string(), message: z.string() })),
});
export type ImportRedirectsResult = z.infer<typeof importRedirectsResultSchema>;

/** One line of a redirects CSV that could not be used. Lines count from 1, the header included. */
export interface RedirectCsvProblem {
  line: number;
  message: string;
}

export interface ParsedRedirectsCsv {
  redirects: z.output<typeof createRedirectRequestSchema>[];
  problems: RedirectCsvProblem[];
}

/**
 * Reads a redirects CSV: `from,to[,status]` per line, comma- or semicolon-separated, quotes allowed. A first line
 * whose first cell is not an address (`from`, `Old URL`...) is taken as a header. The status defaults to 301. When
 * one address appears twice, the later line wins.
 */
export function parseRedirectsCsv(text: string): ParsedRedirectsCsv {
  const rows = csvRows(text.replace(/^\uFEFF/, ''));
  const byFrom = new Map<string, z.output<typeof createRedirectRequestSchema>>();
  const problems: RedirectCsvProblem[] = [];

  rows.forEach(({ cells, line }, index) => {
    if (cells.every((cell) => !cell.trim())) return;
    const [from = '', to = '', status = ''] = cells.map((cell) => cell.trim());
    if (index === 0 && !from.startsWith('/') && !/^https?:\/\//i.test(from)) return;

    const code = status ? Number(status) : 301;
    const parsed = createRedirectRequestSchema.safeParse({ fromPath: from, toPath: to, status: code });
    if (parsed.success) {
      byFrom.delete(parsed.data.fromPath);
      byFrom.set(parsed.data.fromPath, parsed.data);
      return;
    }
    const issue = parsed.error.issues[0];
    const message =
      issue.path[0] === 'status' ? 'The status must be 301 (permanent) or 302 (temporary).' : issue.message;
    problems.push({ line, message });
  });

  return { redirects: [...byFrom.values()], problems };
}

/** The cells of each line, honouring double quotes (which may hold separators, quotes as `""`, and line breaks). */
function csvRows(text: string): { cells: string[]; line: number }[] {
  const firstLine = text.split(/\r?\n/, 1)[0];
  const separator = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        if (char === '\n') line++;
        cell += char;
      }
    } else if (char === '"' && !cell.trim()) {
      quoted = true;
      cell = '';
    } else if (char === separator) {
      cells.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      cells.push(cell);
      rows.push({ cells, line: rowLine });
      cells = [];
      cell = '';
      line++;
      rowLine = line;
    } else {
      cell += char;
    }
  }
  if (cell || cells.length) {
    cells.push(cell);
    rows.push({ cells, line: rowLine });
  }
  return rows;
}

/** A CSV of redirects in the form {@link parseRedirectsCsv} reads, for export. */
export function redirectsCsv(redirects: readonly { fromPath: string; toPath: string; status: number }[]): string {
  const quote = (value: string) => (/[",;\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return ['from,to,status', ...redirects.map((r) => [quote(r.fromPath), quote(r.toPath), String(r.status)].join(','))].join('\r\n') + '\r\n';
}

// --- Addresses with no page (404s) --------------------------------------------------------------

export const notFoundQuerySchema = z.object({
  /** How many days back, today included. */
  days: z.coerce.number().int().min(1).max(90).default(30),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type NotFoundQuery = z.input<typeof notFoundQuerySchema>;

/** One address visitors found no page at, over the days asked for. Addresses that now redirect are left out. */
export const notFoundSummarySchema = z.object({
  path: z.string(),
  hits: z.int(),
  /** On how many of those days it was visited. */
  days: z.int(),
  lastSeenAt: z.string(),
  lastReferrer: z.string().nullable(),
});
export type NotFoundSummary = z.infer<typeof notFoundSummarySchema>;

// --- Delivery -----------------------------------------------------------------------------------

/** Every redirect of the token's space, for the site's server to apply before rendering. */
export const deliveryRedirectsSchema = z.object({
  items: z.array(z.object({ from: z.string(), to: z.string(), status: redirectStatusSchema })),
});
export type DeliveryRedirects = z.infer<typeof deliveryRedirectsSchema>;

/**
 * `POST /v1/delivery/not-found`: the site's server tells the CMS an address had no page. Recorded once per address
 * and day, counting visits.
 */
export const notFoundReportSchema = z.strictObject({
  path: z
    .string()
    .max(4096)
    .transform((value, ctx) => {
      const path = normaliseSitePath(value);
      if (!path) {
        ctx.addIssue({ code: 'custom', message: 'Send the address as a path starting with /.' });
        return z.NEVER;
      }
      return path;
    }),
  /** The `Referer` the visitor's browser sent, if any. Only http(s) URLs are kept. */
  referrer: z
    .string()
    .max(2048)
    .nullish()
    .transform((value) => (value && /^https?:\/\/[^/\s]/i.test(value) ? value : null)),
});
export type NotFoundReport = z.input<typeof notFoundReportSchema>;
