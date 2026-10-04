import { badRequest } from '@novan/api-common';
import { type AssetKind, SVG_MIME } from '@novan/shared-schemas';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';

/** What the file name promised (`fileTypeOf`). */
export interface ExpectedType {
  extension: string;
  mime: string;
  kind: AssetKind;
}

/** A checked file, ready to store: SVG comes back sanitised, everything else unchanged. */
export interface InspectedFile {
  bytes: Buffer;
  mime: string;
  width: number | null;
  height: number | null;
}

/** sharp's name for each raster image type (AVIF is read as HEIF with AV1 compression). */
const sharpFormats: Record<string, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'heif',
};

const startsWith = (bytes: Buffer, signature: number[] | string, offset = 0): boolean => {
  const expected = typeof signature === 'string' ? Buffer.from(signature, 'latin1') : Buffer.from(signature);
  return bytes.length >= offset + expected.length && bytes.subarray(offset, offset + expected.length).equals(expected);
};

/** Programs and scripts, whatever their name says. */
function isExecutable(bytes: Buffer): boolean {
  return (
    startsWith(bytes, 'MZ') ||
    startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46]) ||
    [
      [0xfe, 0xed, 0xfa, 0xce],
      [0xfe, 0xed, 0xfa, 0xcf],
      [0xce, 0xfa, 0xed, 0xfe],
      [0xcf, 0xfa, 0xed, 0xfe],
      [0xca, 0xfe, 0xba, 0xbe],
    ].some((magic) => startsWith(bytes, magic)) ||
    startsWith(bytes, '#!')
  );
}

/** Text a browser would treat as a web page. */
const htmlLike =
  /^\s*(<!--[\s\S]*?-->\s*)*<(!doctype\s+html|html|head|body|script|iframe|meta|object|embed|title)[\s>/]/i;

/** Checks for the magic bytes of non-image types. */
const signatures: Record<string, (bytes: Buffer) => boolean> = {
  'video/mp4': (b) => startsWith(b, 'ftyp', 4),
  'video/quicktime': (b) =>
    startsWith(b, 'ftyp', 4) || startsWith(b, 'moov', 4) || startsWith(b, 'mdat', 4) || startsWith(b, 'wide', 4),
  'video/webm': (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]),
  'application/pdf': (b) => startsWith(b, '%PDF-'),
  'application/zip': isZip,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': isZip,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': isZip,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': isZip,
  'application/msword': isOle,
  'application/vnd.ms-excel': isOle,
  'application/vnd.ms-powerpoint': isOle,
  'text/plain': isPlainText,
  'text/csv': isPlainText,
};

function isZip(bytes: Buffer): boolean {
  return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]);
}

function isOle(bytes: Buffer): boolean {
  return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
}

function isPlainText(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return !htmlLike.test(text.replace(/^\uFEFF/, ''));
  } catch {
    return false;
  }
}

const purify = createDOMPurify(new JSDOM('').window);
// No links out of the file: `href`s may only point at fragments inside it (gradients, clip paths).
purify.addHook('uponSanitizeAttribute', (_node, data) => {
  if ((data.attrName === 'href' || data.attrName === 'xlink:href') && !data.attrValue.trim().startsWith('#')) {
    data.keepAttr = false;
  }
});

/**
 * Removes scripts, event handlers, external references and anything else that is not plain SVG
 * drawing (DOMPurify's SVG profile). Returns null when nothing usable is left.
 */
export function sanitizeSvg(source: string): string | null {
  // The DOCTYPE may carry an internal subset of entity declarations: `<!DOCTYPE svg [ ... ]>`.
  const body = source
    .replace(/^\uFEFF/, '')
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>/gi, '');
  const clean = purify.sanitize(body, { USE_PROFILES: { svg: true, svgFilters: true } });
  return /^\s*<svg[\s>]/i.test(clean) ? `<?xml version="1.0" encoding="UTF-8"?>\n${clean.trim()}\n` : null;
}

/** An SVG's size from its root `width`/`height` (unitless or px), else its `viewBox`. */
export function svgSize(svg: string): { width: number; height: number } | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? '';
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(root)?.[1]?.trim();
  const px = (value: string | undefined) =>
    value && /^\d+(\.\d+)?(px)?$/.test(value) ? Math.round(parseFloat(value)) : null;
  const width = px(attr('width'));
  const height = px(attr('height'));
  if (width && height) return { width, height };
  const box = attr('viewBox')
    ?.split(/[\s,]+/)
    .map(Number);
  if (box?.length === 4 && box[2] > 0 && box[3] > 0) return { width: Math.round(box[2]), height: Math.round(box[3]) };
  return null;
}

const mismatch = (expected: ExpectedType) =>
  badRequest('file_type_mismatch', `This file is not really a .${expected.extension} file, so it was not added.`);

/**
 * Checks that a file's bytes are what its name says (so an HTML page or program cannot pass as a
 * picture), reads image dimensions, and sanitises SVG. Throws 400 problems for anything refused.
 */
export async function inspectFile(bytes: Buffer, expected: ExpectedType): Promise<InspectedFile> {
  if (bytes.length === 0) throw badRequest('file_empty', 'This file is empty.');
  if (isExecutable(bytes))
    throw badRequest('file_unsafe', 'Programs and scripts cannot be added to the media library.');

  if (expected.mime === SVG_MIME) {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw mismatch(expected);
    }
    const clean = sanitizeSvg(text);
    if (!clean) throw mismatch(expected);
    const size = svgSize(clean);
    return {
      bytes: Buffer.from(clean, 'utf8'),
      mime: SVG_MIME,
      width: size?.width ?? null,
      height: size?.height ?? null,
    };
  }

  const format = sharpFormats[expected.mime];
  if (format) {
    let meta: sharp.Metadata;
    try {
      meta = await sharp(bytes, { failOn: 'error', animated: true }).metadata();
    } catch {
      throw mismatch(expected);
    }
    if (meta.format !== format || !meta.width || !meta.height) throw mismatch(expected);
    // Animated images stack their frames; EXIF orientations 5 to 8 turn the picture on its side.
    const frameHeight = meta.pageHeight ?? meta.height;
    const sideways = (meta.orientation ?? 1) >= 5;
    return {
      bytes,
      mime: expected.mime,
      width: sideways ? frameHeight : meta.width,
      height: sideways ? meta.width : frameHeight,
    };
  }

  const check = signatures[expected.mime];
  if (!check?.(bytes)) throw mismatch(expected);
  return { bytes, mime: expected.mime, width: null, height: null };
}
