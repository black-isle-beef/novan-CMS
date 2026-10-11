import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DbService } from '@novan/api-db';
import { JobHandlers } from '@novan/api-jobs';
import { sql } from 'drizzle-orm';

const BATCH = 1000;
/** At most this many batches a night, so a backlog cannot hold the queue for long. */
const MAX_BATCHES = 50;

/**
 * Retention (0020_forms.sql): every night `purge-form-submissions` on the `housekeeping` queue deletes submissions
 * older than their space's retention period (12 months unless set). Running it twice does no harm.
 */
@Injectable()
export class FormsHousekeeping implements OnModuleInit {
  private readonly logger = new Logger(FormsHousekeeping.name);

  constructor(
    private readonly db: DbService,
    private readonly jobs: JobHandlers,
  ) {}

  onModuleInit(): void {
    this.jobs.register('housekeeping', 'purge-form-submissions', async () => void (await this.purgeExpired()));
  }

  /** Deletes expired submissions; resolves with how many. */
  async purgeExpired(): Promise<number> {
    let total = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const [{ n }] = await this.db.serviceDb.execute<{ n: number }>(sql`select public.purge_expired_form_submissions(${BATCH}::int) as n`);
      total += n;
      if (n < BATCH) break;
    }
    if (total) this.logger.log(`Deleted ${total} form submissions past their retention`);
    return total;
  }
}
