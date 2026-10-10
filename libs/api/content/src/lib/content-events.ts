import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { DbService, type DbTransaction } from '@novan/api-db';
import { dispatchWebhooks, enqueue, type Job } from '@novan/api-jobs';
import { filter, type Observable, Subject } from 'rxjs';

interface EntryEventBase {
  spaceId: string;
  environmentId: string;
  entryId: string;
  contentType: string;
  /** The published address the event concerns, without a locale prefix, e.g. `/blog/hello-world`. */
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

/** The space's locales or locale prefixes changed (package 16): every delivered page may read differently. */
export interface LocalesChangedEvent {
  type: 'locales.changed';
  spaceId: string;
  actorId: string;
}

export type ContentEvent = EntryPublishedEvent | EntryUnpublishedEvent | PathsChangedEvent | RedirectsChangedEvent | LocalesChangedEvent;
export type ContentEventType = ContentEvent['type'];

/** The purge job a content event becomes (`@novan/api-delivery` runs it). */
export interface ContentChangedJob extends Job {
  type: 'content-changed';
  spaceId: string;
  event: ContentEvent;
}

/**
 * Content changes. {@link emit} records an event in the transaction that made the change: its side effects (the CDN
 * purge) go on the `purge` queue in that transaction, so they survive a restart and never run for a change that rolled
 * back (docs/build/17-scheduling-releases-webhooks.md), and the space's webhooks are told through a `dispatch` job. Once it commits, this process's `events$` subscribers hear of
 * it too; they are for in-memory state only (another instance never hears), never for work that must happen.
 */
@Injectable()
export class ContentEvents implements OnModuleDestroy {
  private readonly subject = new Subject<ContentEvent>();

  constructor(private readonly db: DbService) {}

  /** Every event, once committed, in this process. A subscriber that throws does not affect the request. */
  readonly events$: Observable<ContentEvent> = this.subject.asObservable();

  on<T extends ContentEventType>(type: T): Observable<Extract<ContentEvent, { type: T }>> {
    return this.events$.pipe(filter((event): event is Extract<ContentEvent, { type: T }> => event.type === type));
  }

  async emit(tx: DbTransaction, event: ContentEvent): Promise<void> {
    await enqueue(tx, 'purge', { type: 'content-changed', spaceId: event.spaceId, event } satisfies ContentChangedJob);
    await dispatchWebhooks(tx, event.spaceId, event);
    this.db.afterCommit(tx, () => this.subject.next(event));
  }

  onModuleDestroy(): void {
    this.subject.complete();
  }
}
