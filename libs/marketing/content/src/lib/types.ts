/** A link inside copy. Paths starting with `/` stay in the site; anything else is a plain anchor. */
export interface TextLink {
  text: string;
  href: string;
}

/** A run of copy: plain text and links, in order. */
export type Inline = string | TextLink;

/** A paragraph: plain text, or text with links in it. */
export type Paragraph = string | readonly Inline[];

/** A link to a page of this site, with optional query parameters (e.g. a preselected enquiry type). */
export interface SiteLink {
  label: string;
  path: string;
  queryParams?: Readonly<Record<string, string>>;
}

/** Title and description of a page, for `<title>`, the meta description and social cards. */
export interface PageMeta {
  title: string;
  description: string;
}
