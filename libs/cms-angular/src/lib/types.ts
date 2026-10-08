// What the Delivery and Preview APIs send (docs/build/08-delivery-preview-api.md). The SDK is published on its
// own, so these mirror `@novan/shared-schemas` instead of importing it; `types.spec.ts` keeps them in step.

/** One page or entry. `data` holds one key per field `apiId`, with references, files and links expanded. */
export interface NovanEntry<TData = Record<string, unknown>> {
  id: string;
  /** Content type api id, e.g. `page`. */
  contentType: string;
  /** Folder path and slug, e.g. `/blog/hello-world`; the home page is `/`. */
  path: string;
  locale: string;
  /** Delivery: when this version went live. Preview: when it was last saved. */
  updatedAt: string;
  data: TData;
}

/** The fields every page has; content types add their own. */
export interface PageData {
  title?: string;
  slug?: string;
  seo?: NovanSeoFields | null;
  body?: NovanBlockNode[] | null;
  [field: string]: unknown;
}

export type Page<TData = PageData> = NovanEntry<TData>;

/** One page of `entries`. Pass `nextCursor` as `cursor` for the next; null on the last. */
export interface Paged<TData = Record<string, unknown>> {
  items: NovanEntry<TData>[];
  nextCursor: string | null;
}

/** A file from the media library, as delivered. */
export interface NovanAsset {
  id: string;
  /** The image route (`<api>/v1/assets/<id>/<filename>?v=<revision>`), or a signed URL in preview. */
  url: string;
  filename: string;
  mime: string;
  width: number | null;
  height: number | null;
  /** The page's own alt text, else the library's. */
  alt: string | null;
  focal: { x: number; y: number } | null;
}

/** A block in a `blocks` field. Its other keys are the block type's fields. */
export interface NovanBlockNode {
  _uid: string;
  _block: string;
  /** The style options an editor chose, e.g. `{ tone: 'brand' }`; given to the component's `settings` input. */
  _style?: Record<string, string | boolean>;
  /** Hidden by an editor: kept in the page but never shown (the API leaves such blocks out already). */
  _hidden?: boolean;
  children?: NovanBlockNode[];
  [field: string]: unknown;
}

/** A `link` field's value. Internal links carry the `path` of the page (null when it is not published). */
export type NovanLinkValue =
  | { type: 'internal'; entryId: string; path?: string | null; anchor?: string; text?: string }
  | { type: 'external'; url: string; text?: string }
  | { type: 'email'; email: string; text?: string };

/** Rich text as Tiptap stores it (ProseMirror JSON). */
export interface ProseMirrorNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: ProseMirrorNode[];
}

/** The `seo` group of the `page` type (package 14 adds the canonical override and image). */
export interface NovanSeoFields {
  metaTitle?: string | null;
  metaDescription?: string | null;
  canonical?: string | null;
  ogImage?: NovanAsset | null;
  noindex?: boolean | null;
}
