import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { assets, auditEvents, DbService } from '@novan/api-db';
import { JobHandlers } from '@novan/api-jobs';
import { and, asc, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { MediaStorage } from './media-storage';

const BATCH = 100;
const MAX_BATCHES = 50;

/**
 * Nightly `purge-assets` job (0018_housekeeping.sql): files in the bin for 30 days are deleted from Storage and then
 * from the library, and audited. If Storage refuses, the records stay and the job is retried, so no record outlives
 * its file and no file is lost track of.
 */
@Injectable()
export class MediaHousekeeping implements OnModuleInit {
  private readonly logger = new Logger(MediaHousekeeping.name);

  constructor(
    private readonly db: DbService,
    private readonly storage: MediaStorage,
    private readonly jobs: JobHandlers,
  ) {}

  onModuleInit(): void {
    this.jobs.register('housekeeping', 'purge-assets', () => this.purgeAssets().then(() => undefined));
  }

  /** Deletes files in the bin for longer than `olderThanDays`; resolves with how many. */
  async purgeAssets(olderThanDays = 30): Promise<number> {
    let total = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const due = await this.db.serviceDb
        .select({ id: assets.id, spaceId: assets.spaceId, path: assets.path, filename: assets.filename, deletedAt: assets.deletedAt })
        .from(assets)
        .where(and(isNotNull(assets.deletedAt), lt(assets.deletedAt, sql`now() - make_interval(days => ${olderThanDays})`)))
        .orderBy(asc(assets.deletedAt))
        .limit(BATCH);
      if (!due.length) break;
      await this.storage.removeOrThrow(due.map((asset) => asset.path));
      await this.db.transaction(async (tx) => {
        await tx.delete(assets).where(inArray(assets.id, due.map((asset) => asset.id)));
        await tx.insert(auditEvents).values(
          due.map((asset) => ({
            spaceId: asset.spaceId,
            action: 'asset.purged',
            targetType: 'asset',
            targetId: asset.id,
            diff: { filename: asset.filename, deletedAt: asset.deletedAt },
          })),
        );
      });
      total += due.length;
      if (due.length < BATCH) break;
    }
    if (total) this.logger.log(`Purged ${total} files from the bin`);
    return total;
  }
}
