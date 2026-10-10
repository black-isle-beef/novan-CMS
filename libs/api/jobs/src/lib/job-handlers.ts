import { Injectable } from '@nestjs/common';
import type { Job, QueueName } from './queues';

/** What a handler knows about the job it runs. */
export interface JobContext {
  queue: QueueName;
  msgId: string;
  /** 1 on the first try. A job read before by a worker that died counts that try too. */
  attempt: number;
  /** No retry follows if this attempt fails: the job goes to the dead letters. */
  final: boolean;
  enqueuedAt: string;
}

/**
 * Runs one job. Resolving deletes it; throwing retries it with back-off (or dead-letters it on the last attempt).
 * A job can run more than once (a worker can die after the work but before the delete), so handlers are idempotent.
 */
export type JobHandler = (job: Job, context: JobContext) => Promise<void>;

/** A failure no retry can fix (a malformed job, say): the job goes straight to the dead letters. */
export class PermanentJobError extends Error {
  override readonly name = 'PermanentJobError';
}

/** Which handler runs each type of job on each queue. Feature modules register theirs when they start. */
@Injectable()
export class JobHandlers {
  private readonly handlers = new Map<string, JobHandler>();

  register(queue: QueueName, type: string, handler: JobHandler): void {
    const key = `${queue}:${type}`;
    if (this.handlers.has(key)) throw new Error(`A handler for "${type}" jobs on the ${queue} queue is already registered`);
    this.handlers.set(key, handler);
  }

  find(queue: QueueName, type: unknown): JobHandler | undefined {
    return typeof type === 'string' ? this.handlers.get(`${queue}:${type}`) : undefined;
  }
}
