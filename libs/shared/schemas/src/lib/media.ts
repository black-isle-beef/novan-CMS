import { z } from 'zod';
import { mediaKinds } from './fields';

// The media library (docs/build/07-media-library.md), served under
// /v1/management/spaces/:spaceId/assets, and the image route client sites use, /v1/assets/:id/:filename.

export type AssetKind = (typeof mediaKinds)[number];

/** The private storage bucket. Files live at `spaces/<space_id>/<asset_id>/<filename>`. */
export const MEDIA_BUCKET = 'media';

const MB = 1024 * 1024;

/**
 * The file types the library accepts, by extension. Anything else is refused, which keeps out HTML,
 * scripts and executables. SVG is an image that can carry script, so a space must allow it
 * (`settings.media.allowSvg`) and the API then sanitises it.
 */
export const acceptedFileTypes: Readonly<Record<string, { mime: string; kind: AssetKind }>> = {
  jpg: { mime: 'image/jpeg', kind: 'image' },
  jpeg: { mime: 'image/jpeg', kind: 'image' },
  png: { mime: 'image/png', kind: 'image' },
  gif: { mime: 'image/gif', kind: 'image' },
  webp: { mime: 'image/webp', kind: 'image' },
  avif: { mime: 'image/avif', kind: 'image' },
  svg: { mime: 'image/svg+xml', kind: 'image' },
  mp4: { mime: 'video/mp4', kind: 'video' },
  webm: { mime: 'video/webm', kind: 'video' },
  mov: { mime: 'video/quicktime', kind: 'video' },
  pdf: { mime: 'application/pdf', kind: 'file' },
  txt: { mime: 'text/plain', kind: 'file' },
  csv: { mime: 'text/csv', kind: 'file' },
  zip: { mime: 'application/zip', kind: 'file' },
  doc: { mime: 'application/msword', kind: 'file' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'file' },
  xls: { mime: 'application/vnd.ms-excel', kind: 'file' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'file' },
  ppt: { mime: 'application/vnd.ms-powerpoint', kind: 'file' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'file' },
};

export const SVG_MIME = 'image/svg+xml';

/** What a file name says the file is, or null when the library does not take that type. */
export function fileTypeOf(filename: string): { extension: string; mime: string; kind: AssetKind } | null {
  const extension = /\.([A-Za-z0-9]+)$/.exec(filename)?.[1]?.toLowerCase();
  const type = extension ? acceptedFileTypes[extension] : undefined;
  return extension && type ? { extension, ...type } : null;
}

export function kindOfMime(mime: string): AssetKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

/** Upload size limits by organisation plan. Plans without their own limits get `default`. */
export const uploadLimits: Readonly<Record<string, { image: number; other: number }>> = {
  default: { image: 20 * MB, other: 50 * MB },
};

export function uploadLimit(plan: string | null | undefined, kind: AssetKind): number {
  const limits = uploadLimits[plan ?? 'default'] ?? uploadLimits['default'];
  return kind === 'image' ? limits.image : limits.other;
}

/** "20 MB", for messages. */
export function formatBytes(bytes: number): string {
  if (bytes >= MB) return `${Math.round((bytes / MB) * 10) / 10} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/**
 * A storage-safe file name: letters, numbers, dots, hyphens and underscores, starting with a letter or
 * number, at most 150 characters, extension in lowercase. `Café menu (2).PDF` becomes `cafe-menu-2.pdf`.
 */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const extension =
    dot > 0
      ? base
          .slice(dot + 1)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
      : '';
  const clean = (text: string) =>
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/[-.]{2,}/g, '-')
      .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
  const suffix = extension ? `.${extension.slice(0, 10)}` : '';
  const safeStem =
    clean(stem)
      .slice(0, 150 - suffix.length)
      .replace(/[^A-Za-z0-9]+$/, '') || 'file';
  return `${safeStem}${suffix}`;
}

/** The title a new file gets: its name without the extension, as people wrote it. */
export function titleFromFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return (dot > 0 ? base.slice(0, dot) : base).replace(/[_-]+/g, ' ').trim().slice(0, 200);
}

// --- Fields of an asset -------------------------------------------------------------------------

/** `Brand/Logos`: names of up to 60 characters joined by `/`. */
export const assetFolderSchema = z
  .string()
  .trim()
  .max(200)
  .transform((value) =>
    value
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean)
      .join('/'),
  )
  .pipe(
    z
      .string()
      .min(1, 'Enter a folder name.')
      .refine(
        (value) => value.split('/').every((part) => part.length <= 60),
        'Keep each folder name to 60 characters or fewer.',
      ),
  );

export const assetTagSchema = z.string().trim().toLowerCase().min(1).max(40);
export const assetTagsSchema = z
  .array(assetTagSchema)
  .max(30, 'Use 30 tags or fewer.')
  .transform((tags) => [...new Set(tags)]);

/** Where to keep in view when cropping: fractions of the width and height from the top left. */
export const focalPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});
export type FocalPoint = z.infer<typeof focalPointSchema>;

export const altTextSchema = z.string().trim().max(500, 'Use 500 characters or fewer.');

// --- Assets -------------------------------------------------------------------------------------

export const assetSchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  title: z.string().nullable(),
  mime: z.string(),
  kind: z.enum(mediaKinds),
  sizeBytes: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  focal: focalPointSchema.nullable(),
  alt: z.string().nullable(),
  tags: z.array(z.string()),
  folder: z.string().nullable(),
  /** Goes up each time the file is replaced. */
  revision: z.number(),
  uploadedBy: z.uuid().nullable(),
  uploadedByName: z.string().nullable(),
  /** Published pages and entries using it. */
  usageCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Set while the asset is in the bin. */
  deletedAt: z.string().nullable(),
});
export type Asset = z.infer<typeof assetSchema>;

export const assetUsageSchema = z.object({
  entryId: z.uuid(),
  title: z.string(),
  path: z.string(),
  /** Where in the entry, e.g. `body.<block uid>.image`. */
  fieldPath: z.string(),
});
export type AssetUsage = z.infer<typeof assetUsageSchema>;

export const assetDetailSchema = assetSchema.extend({ usages: z.array(assetUsageSchema) });
export type AssetDetail = z.infer<typeof assetDetailSchema>;

export const assetFolderSummarySchema = z.object({ folder: z.string(), count: z.number() });
export type AssetFolderSummary = z.infer<typeof assetFolderSummarySchema>;

export const listAssetsQuerySchema = z.strictObject({
  /** Matches the file name, title, alt text or a tag, ignoring case. */
  search: z.string().trim().max(100).optional(),
  /** A folder (its subfolders included), or `root` for files outside any folder. */
  folder: z.union([z.literal('root'), assetFolderSchema]).optional(),
  tag: assetTagSchema.optional(),
  kind: z.enum(mediaKinds).optional(),
  /** Several ids at once, comma separated (the media field's previews). */
  ids: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(',').filter(Boolean) : undefined))
    .pipe(z.array(z.uuid()).max(100).optional()),
  /** `true` lists the bin instead. */
  deleted: z
    .enum(['true', 'false'], 'Use deleted=true or deleted=false.')
    .optional()
    .transform((value) => value === 'true'),
});
export type ListAssetsQuery = z.input<typeof listAssetsQuerySchema>;

/** Asks for somewhere to upload one file. The API checks the type and the size against the plan's limits. */
export const uploadUrlRequestSchema = z.strictObject({
  filename: z.string().trim().min(1, 'The file needs a name.').max(255),
  sizeBytes: z.int().positive('This file is empty.'),
});
export type UploadUrlRequest = z.input<typeof uploadUrlRequestSchema>;

export const uploadUrlResponseSchema = z.object({
  assetId: z.uuid(),
  /** The storage-safe name the file will have. */
  filename: z.string(),
  mime: z.string(),
  /** Signed Supabase Storage URL to `PUT` the file to; valid for two hours. */
  uploadUrl: z.string(),
  maxBytes: z.number(),
});
export type UploadUrlResponse = z.infer<typeof uploadUrlResponseSchema>;

/** After the upload: the API checks the file and adds it to the library. */
export const completeUploadRequestSchema = z.strictObject({
  assetId: z.uuid(),
  filename: z.string().trim().min(1).max(255),
  title: z.string().trim().max(200).nullish(),
  alt: altTextSchema.nullish(),
  tags: assetTagsSchema.optional(),
  folder: assetFolderSchema.nullish(),
});
export type CompleteUploadRequest = z.input<typeof completeUploadRequestSchema>;

/** Describes an asset. `null` clears a value. */
export const updateAssetRequestSchema = z
  .strictObject({
    title: z.string().trim().max(200).nullish(),
    alt: altTextSchema.nullish(),
    tags: assetTagsSchema.optional(),
    folder: assetFolderSchema.nullish(),
    focal: focalPointSchema.nullish(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one of title, alt, tags, folder or focal.');
export type UpdateAssetRequest = z.input<typeof updateAssetRequestSchema>;

/** Replaces the file and keeps the asset id, so every page using it shows the new file. */
export const completeReplaceRequestSchema = z.strictObject({ filename: z.string().trim().min(1).max(255) });
export type CompleteReplaceRequest = z.input<typeof completeReplaceRequestSchema>;

// --- Delivery -----------------------------------------------------------------------------------

/** How a media item reaches client sites (the Delivery API, package 08, expands `{ assetId, alt }` to this). */
export const deliveryAssetSchema = z.object({
  id: z.uuid(),
  /** `<api>/v1/assets/<id>/<filename>?v=<revision>`: the original file, or a transformed image with options. */
  url: z.string(),
  filename: z.string(),
  mime: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  /** The page's own alt text, else the library's. */
  alt: z.string().nullable(),
  focal: focalPointSchema.nullable(),
});
export type DeliveryAsset = z.infer<typeof deliveryAssetSchema>;

export const imageResizeModes = ['cover', 'contain', 'fill'] as const;

const dimension = z.coerce.number().int().min(1).max(2500);

/** Query of the image route: resize options (applied only where Supabase image transformations are on). */
export const imageTransformSchema = z.strictObject({
  width: dimension.optional(),
  height: dimension.optional(),
  resize: z.enum(imageResizeModes).optional(),
  quality: z.coerce.number().int().min(20).max(100).optional(),
  /** The asset's revision; only there to change the URL when the file is replaced. */
  v: z.coerce.number().int().positive().optional(),
});
export type ImageTransform = Omit<z.output<typeof imageTransformSchema>, 'v'>;

/** The address of an asset on the image route. */
export function assetUrl(apiUrl: string, asset: { id: string; filename: string; revision: number }): string {
  return `${apiUrl.replace(/\/+$/, '')}/v1/assets/${asset.id}/${encodeURIComponent(asset.filename)}?v=${asset.revision}`;
}

/**
 * Adds resize options to an image's delivery URL, e.g. `imageUrl(hero, { width: 1200, resize: 'cover' })`.
 * The API applies them through Supabase image transformations, which need the Supabase Pro plan; where they
 * are off (local, free plan) it sends the original image.
 */
export function imageUrl(asset: Pick<DeliveryAsset, 'url'>, options: ImageTransform = {}): string {
  const url = new URL(asset.url);
  for (const key of ['width', 'height', 'resize', 'quality'] as const) {
    const value = options[key];
    if (value === undefined) url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
  return url.toString();
}
