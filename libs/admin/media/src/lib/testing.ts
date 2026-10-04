import type { Asset } from '@novan/shared-schemas';

/** A library file for tests: an image `photo-<n>.jpg` with id `...<n>`. */
export const asset = (n: number, extra: Partial<Asset> = {}): Asset => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  filename: `photo-${n}.jpg`,
  title: `Photo ${n}`,
  mime: 'image/jpeg',
  kind: 'image',
  sizeBytes: 1000,
  width: 40,
  height: 30,
  focal: null,
  alt: null,
  tags: [],
  folder: null,
  revision: 1,
  uploadedBy: null,
  uploadedByName: null,
  usageCount: 0,
  createdAt: '2026-10-04T09:00:00Z',
  updatedAt: '2026-10-04T09:00:00Z',
  deletedAt: null,
  ...extra,
});
