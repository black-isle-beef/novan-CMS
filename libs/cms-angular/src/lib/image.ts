import type { NovanAsset } from './types';

export interface NovanImageOptions {
  /** 1 to 2500 pixels. */
  width?: number;
  /** 1 to 2500 pixels. */
  height?: number;
  /** How the image fills width × height. */
  fit?: 'cover' | 'contain' | 'fill';
  /** 20 to 100. */
  quality?: number;
}

const RESIZE_KEYS = ['width', 'height', 'resize', 'quality'] as const;

/**
 * The URL of a delivered image, resized: `novanImage(hero.image, { width: 1200, height: 600, fit: 'cover' })`.
 * The API resizes with Supabase image transformations where they are on and sends the original elsewhere.
 * Preview files are signed Storage URLs, which take no options, so they come back unchanged. An empty
 * string for a missing asset, so templates can bind it straight to `src`.
 */
export function novanImage(asset: Pick<NovanAsset, 'url'> | null | undefined, options: NovanImageOptions = {}): string {
  if (!asset?.url) return '';
  const relative = asset.url.startsWith('/');
  let url: URL;
  try {
    url = new URL(asset.url, 'http://relative.invalid');
  } catch {
    return asset.url;
  }
  if (!/\/v1\/assets\/[^/]+\/[^/]+$/.test(url.pathname)) return asset.url;

  const values: Record<(typeof RESIZE_KEYS)[number], number | string | undefined> = {
    width: dimension(options.width, 1, 2500),
    height: dimension(options.height, 1, 2500),
    resize: options.fit,
    quality: dimension(options.quality, 20, 100),
  };
  for (const key of RESIZE_KEYS) {
    const value = values[key];
    if (value === undefined) url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
  return relative ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}

function dimension(value: number | undefined, min: number, max: number): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, Math.round(value)));
}
