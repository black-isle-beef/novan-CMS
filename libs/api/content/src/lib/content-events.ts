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

/**
 * Published addresses changed without a publish: a published page was moved to another folder, or a folder above
 * published pages was renamed or moved. The database redirected each old address to its new one (0012_seo_site.sql).
 */
export interface PathsChangedEvent {
  type: 'paths.changed';
  spaceId: string;
  environmentId: string;
  /** The published entries whose address changed. */
  entryIds: string[];
  /** Their tags (package 08): the pages embed their own path. */
  cacheTags: string[];
  /** Old and new addresses as stored, e.g. `/blog/hello`. */
  paths: string[];
  actorId: string;
}

/** A person added, changed, imported or deleted redirects (package 14). */
export interface RedirectsChangedEvent {
  type: 'redirects.changed';
  spaceId: string;
  /** The addresses redirected from, before and after the change. */
  paths: string[];
  actorId: string;
}

export type ContentEvent = EntryPublishedEvent | EntryUnpublishedEvent | PathsChangedEvent | RedirectsChangedEvent;
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
