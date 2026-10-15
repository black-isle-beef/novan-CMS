// media.ts — uploads a migration's files to a space's media library through the Management API, once.
import { safeFilename } from '@novan/shared-schemas';
import { openAsBlob } from 'node:fs';
import { join } from 'node:path';

import type { NovanApi } from '../novan-cli/src/lib/api';
import type { MediaFile } from './laws-paws.content';

/** The parts of the API the upload uses (so specs can stand in for it). */
export type MediaApi = Pick<NovanApi, 'assets' | 'assetUploadUrl' | 'putFile' | 'completeAssetUpload'>;

export interface MediaSyncOptions {
  /** The old site's `public` folder. */
  sourceDir: string;
  dryRun: boolean;
  log: (line: string) => void;
}

/**
 * Each file's asset id, uploading the ones the library does not have yet. A file counts as there when a live asset in
 * its folder has the same (storage-safe) file name, so running the migration again uploads nothing twice. A file
 * moved to the bin is uploaded again.
 */
export async function syncMedia(
  api: MediaApi,
  spaceId: string,
  files: readonly MediaFile[],
  options: MediaSyncOptions,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const folders = [...new Set(files.map((file) => file.folder))];
  const existing = (await Promise.all(folders.map((folder) => api.assets(spaceId, folder)))).flat();

  for (const file of files) {
    const filename = safeFilename(file.source);
    const found = existing.find(
      (asset) => asset.folder === file.folder && asset.filename === filename && !asset.deletedAt,
    );
    if (found) {
      ids.set(file.key, found.id);
      options.log(`Kept ${file.folder}/${filename}: it is already in the library.`);
      continue;
    }
    if (options.dryRun) {
      ids.set(file.key, `dry-run:${file.key}`);
      options.log(`Would upload ${file.source} to ${file.folder}.`);
      continue;
    }
    const blob = await openAsBlob(join(options.sourceDir, file.source));
    const target = await api.assetUploadUrl(spaceId, { filename, sizeBytes: blob.size });
    await api.putFile(target, blob);
    const asset = await api.completeAssetUpload(spaceId, {
      assetId: target.assetId,
      filename: target.filename,
      title: file.title,
      alt: file.alt || null,
      tags: file.tags,
      folder: file.folder,
    });
    ids.set(file.key, asset.id);
    options.log(`Uploaded ${file.folder}/${asset.filename}.`);
  }
  return ids;
}
