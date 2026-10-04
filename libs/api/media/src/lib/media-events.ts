import { Injectable, OnModuleDestroy } from '@nestjs/common';
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

/** In-process bus for media changes, emitted after commit (as `ContentEvents`). */
@Injectable()
export class MediaEvents implements OnModuleDestroy {
  private readonly subject = new Subject<MediaEvent>();

  readonly events$: Observable<MediaEvent> = this.subject.asObservable();

  emit(event: MediaEvent): void {
    this.subject.next(event);
  }

  onModuleDestroy(): void {
    this.subject.complete();
  }
}
