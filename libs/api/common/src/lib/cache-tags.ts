/**
 * CDN cache tags (Cloudflare `Cache-Tag`), set on Delivery API and image responses and purged when content
 * changes (docs/build/08-delivery-preview-api.md). One zone serves every space, so tags whose names are
 * not globally unique carry the environment's id: `type:page` alone would purge every space's pages.
 */
export const cacheTag = {
  /** Every delivery response of a space. */
  space: (spaceId: string): string => `space:${spaceId}`,
  /** Responses that include the entry, at the top level or as a resolved reference. */
  entry: (entryId: string): string => `entry:${entryId}`,
  /** Entry lists filtered by the content type, and its singleton. */
  type: (environmentId: string, contentType: string): string => `type:${environmentId}:${contentType}`,
  /** Entry lists not filtered by type: any publish can change them. */
  entries: (environmentId: string): string => `entries:${environmentId}`,
  sitemap: (environmentId: string): string => `sitemap:${environmentId}`,
  /** The space's redirects, and the redirects sites answered with (package 14). */
  redirects: (spaceId: string): string => `redirects:${spaceId}`,
  /** Responses that embed the file's URL, and the file itself on the image route. */
  asset: (assetId: string): string => `asset:${assetId}`,
};
