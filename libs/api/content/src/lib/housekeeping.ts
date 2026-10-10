import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DbService } from '@novan/api-db';
import { JobHandlers } from '@novan/api-jobs';
import { sql } from 'drizzle-orm';

/** Rows a housekeeping function deletes at once; a run repeats until a batch comes back short. */
const BATCH = 500;
/** At most this many batches a run, so one night's backlog cannot hold the queue for long. */
const MAX_BATCHES = 40;

/**
 * Nightly housekeeping for pages and their versions (0018_housekeeping.sql), on the `housekeeping` queue: `purge-bin`
 * deletes entries in the bin for 30 days, `prune-autosaves` old autosave versions. Both are SQL functions that only the
 * API's own connection may run; running them twice does no harm.
 */
@Injectable()
export class ContentHousekeeping implements OnModuleInit {
  private readonly logger = new Logger(ContentHousekeeping.name);

  constructor(
    private readonly db: DbService,
    private readonly jobs: JobHandlers,
  ) {}

  onModuleInit(): void {
    this.jobs.register('housekeeping', 'purge-bin', async () => void (await this.purgeBin()));
    this.jobs.register('housekeeping', 'prune-autosaves', async () => void (await this.pruneAutosaves()));
  }

  /** Deletes entries that have been in the bin for more than 30 days; resolves with how many. */
  async purgeBin(olderThan = '30 days'): Promise<number> {
    const purged = await this.repeat((batch) => sql`select public.purge_binned_entries(${olderThan}::interval, ${batch}::int) as n`);
    if (purged) this.logger.log(`Purged ${purged} entries from the bin`);
    return purged;
  }

  /** Deletes autosave versions older than 90 days that nothing points at; resolves with how many. */
  async pruneAutosaves(keep = '90 days'): Promise<number> {
    const pruned = await this.repeat((batch) => sql`select public.prune_autosave_versions(${keep}::interval, ${batch}::int) as n`);
    if (pruned) this.logger.log(`Pruned ${pruned} old autosave versions`);
    return pruned;
  }

  private async repeat(query: (batch: number) => ReturnType<typeof sql>): Promise<number> {
    let total = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const [{ n }] = await this.db.serviceDb.execute<{ n: number }>(query(BATCH));
      total += n;
      if (n < BATCH) break;
    }
    return total;
  }
}
