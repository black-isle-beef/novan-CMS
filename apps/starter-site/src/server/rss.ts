import { escapeXml } from './sitemap';

/** A blog post as the Delivery API lists it, with the fields the feed reads. */
export interface RssPost {
  path: string;
  locale: string;
  updatedAt: string;
  data: { title?: unknown; summary?: unknown; publishedOn?: unknown };
}

export interface RssChannel {
  /** The site's name (site settings), else the site's address. */
  title: string;
  /** The page listing the posts, e.g. `/blog`. */
  path: string;
  locale: string;
}

/**
 * `rss.xml` (RSS 2.0) for the blog starter kit's posts (kits/blog): newest first, each with its title, address,
 * summary and date. A post without a date uses when it was published.
 */
export function rssXml(siteUrl: string, channel: RssChannel, posts: readonly RssPost[]): string {
  const base = siteUrl.replace(/\/+$/, '');
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const items = posts.map((post) => {
    const link = base + post.path;
    const date = typeof post.data.publishedOn === 'string' && !Number.isNaN(Date.parse(post.data.publishedOn)) ? post.data.publishedOn : post.updatedAt;
    const summary = text(post.data.summary);
    return [
      '    <item>',
      `      <title>${escapeXml(text(post.data.title) || post.path)}</title>`,
      `      <link>${escapeXml(link)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
      `      <pubDate>${new Date(date.length === 10 ? `${date}T00:00:00Z` : date).toUTCString()}</pubDate>`,
      ...(summary ? [`      <description>${escapeXml(summary)}</description>`] : []),
      '    </item>',
    ].join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${escapeXml(channel.title)}</title>`,
    `    <link>${escapeXml(base + channel.path)}</link>`,
    `    <description>${escapeXml(`The latest posts from ${channel.title}`)}</description>`,
    `    <language>${escapeXml(channel.locale)}</language>`,
    `    <atom:link href="${escapeXml(`${base}/rss.xml`)}" rel="self" type="application/rss+xml"/>`,
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}
