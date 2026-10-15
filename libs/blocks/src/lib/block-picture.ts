import { type NovanAsset, novanImage } from '@black-isle-beef/cms-angular';

/** An image field ready to render as a responsive `img`. */
export interface BlockPicture {
  readonly src: string;
  /** Null for files the API cannot resize (preview URLs, other hosts). */
  readonly srcset: string | null;
  readonly sizes: string;
  /** The page's own alt text, else the media library's; empty means decorative. */
  readonly alt: string;
  readonly width: number | null;
  readonly height: number | null;
}

/**
 * An image field as a responsive picture, or null when no image is chosen or the stored value is not an image
 * (stored data is untrusted). `widths` are the sizes offered to the browser (smallest first) and `sizes` how
 * wide the image is shown.
 */
export function blockPicture(value: unknown, widths: readonly number[], sizes: string): BlockPicture | null {
  if (!isAsset(value)) return null;
  const image = value;
  const src = novanImage(image, { width: widths[widths.length - 1] });
  if (!src) return null;
  const candidates = widths.map((width) => ({ width, url: novanImage(image, { width }) }));
  // Files the API cannot resize come back unchanged: no srcset for those.
  const resizable = new Set(candidates.map((candidate) => candidate.url)).size === candidates.length;
  return {
    src,
    srcset: resizable ? candidates.map((candidate) => `${candidate.url} ${candidate.width}w`).join(', ') : null,
    sizes,
    alt: image.alt ?? '',
    width: image.width,
    height: image.height,
  };
}

function isAsset(value: unknown): value is NovanAsset {
  return typeof value === 'object' && value !== null && typeof (value as { url?: unknown }).url === 'string';
}
