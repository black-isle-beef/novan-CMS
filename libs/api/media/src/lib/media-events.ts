import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { DbService, type DbTransaction } from '@novan/api-db';
import { enqueue, type Job } from '@novan/api-jobs';
import { type Observable, Subject } from 'rxjs';

/**
 * A file changed in a way that client sites must see: replaced (same id, new file) or moved to the bin.
 * Pages using it keep their data, so caches are purged by the asset's tag (package 08).
 */
export interface MediaEvent {
  type: 'asset.replaced' | 'asset.deleted';
  spaceId: string;
  assetId: string;
  /** `asset:<id>`, as on image route responses. */
  cacheTags: string[];
  actorId: string;
}

/** The purge job a media event becomes (`@novan/api-delivery` runs it). */
export interface MediaChangedJob extends Job {
  type: 'media-changed';
  spaceId: string;
  event: MediaEvent;
}

/** Media changes, recorded in the change's transaction and queued for purging (as `ContentEvents`). */
@Injectable()
export class MediaEvents implements OnModuleDestroy {
  private readonly subject = new Subject<MediaEvent>();

  constructor(private readonly db: DbService) {}

  /** Every event, once committed, in this process. */
  readonly events$: Observable<MediaEvent> = this.subject.asObservable();

  async emit(tx: DbTransaction, event: MediaEvent): Promise<void> {
    await enqueue(tx, 'purge', { type: 'media-changed', spaceId: event.spaceId, event } satisfies MediaChangedJob);
    this.db.afterCommit(tx, () => this.subject.next(event));
  }

  onModuleDestroy(): void {
    this.subject.complete();
  }
}
