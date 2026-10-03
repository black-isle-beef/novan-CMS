import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { filter, type Observable, Subject } from 'rxjs';

interface EntryEventBase {
  spaceId: string;
  environmentId: string;
  entryId: string;
  contentType: string;
  locale: string;
  /** The published address the event concerns, e.g. `/blog/hello-world`. */
  path: string;
  /** Tags to purge from caches (package 08). */
  cacheTags: string[];
  actorId: string;
}

/** An entry's current version went live. */
export interface EntryPublishedEvent extends EntryEventBase {
  type: 'entry.published';
  versionId: string;
  publishedAt: string;
}

/** An entry was taken off the site (unpublished, or moved to the bin while published). */
export interface EntryUnpublishedEvent extends EntryEventBase {
  type: 'entry.unpublished';
}

export type ContentEvent = EntryPublishedEvent | EntryUnpublishedEvent;
export type ContentEventType = ContentEvent['type'];

/**
 * In-process event bus for content changes. Events are emitted only after their transaction commits.
 * Package 17 moves delivery onto a durable queue; subscribers should not assume they see every event.
 */
@Injectable()
export class ContentEvents implements OnModuleDestroy {
  private readonly subject = new Subject<ContentEvent>();

  /** Every event. A subscriber that throws does not affect the request that emitted the event. */
  readonly events$: Observable<ContentEvent> = this.subject.asObservable();

  on<T extends ContentEventType>(type: T): Observable<Extract<ContentEvent, { type: T }>> {
    return this.events$.pipe(filter((event): event is Extract<ContentEvent, { type: T }> => event.type === type));
  }

  emit(event: ContentEvent): void {
    this.subject.next(event);
  }

  onModuleDestroy(): void {
    this.subject.complete();
  }
}
