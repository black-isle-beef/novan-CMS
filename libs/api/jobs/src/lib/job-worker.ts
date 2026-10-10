import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Mailer } from '@novan/api-common';
import { DbService, jobDeadLetters } from '@novan/api-db';
import { sql } from 'drizzle-orm';
import { type JobContext, JobHandlers, PermanentJobError } from './job-handlers';
import { JOBS_CONFIG, type JobsConfig, retryDelaySeconds } from './jobs-config';
import { type Job, QUEUES, type QueueName } from './queues';

/** A row of `pgmq.read`. `msg_id` is a bigint, which the driver returns as a string. */
interface QueuedJob extends Record<string, unknown> {
  msg_id: string;
  read_ct: number;
  enqueued_at: string;
  message: Job;
}

/**
 * Runs queued jobs (0014_jobs.sql). The API started with `--worker` runs only this; `nx serve api` runs it beside the
 * HTTP server. Each queue is read in its own loop: a job is read with a visibility timeout, run by its handler, and
 * deleted when the handler resolves. A failed job is retried with exponential back-off; after the last attempt, or
 * on a {@link PermanentJobError}, it moves to `job_dead_letters` and the agency is emailed. A worker that dies mid-job
 * loses nothing: the job becomes visible again when its timeout ends.
 */
@Injectable()
export class JobWorker implements OnApplicationShutdown {
  private readonly logger = new Logger(JobWorker.name);
  private running = false;
  private loops: Promise<void>[] = [];
  private readonly sleepers = new Set<() => void>();

  constructor(
    private readonly db: DbService,
    private readonly handlers: JobHandlers,
    private readonly mailer: Mailer,
    @Inject(JOBS_CONFIG) private readonly config: JobsConfig,
  ) {}

  /** Starts reading `queues` until {@link stop}. */
  start(queues: readonly QueueName[] = QUEUES): void {
    if (this.running) return;
    this.running = true;
    this.loops = queues.map((queue) => this.loop(queue));
    this.logger.log(`Running jobs from ${queues.join(', ')}`);
  }

  /** Finishes the jobs in hand and stops; jobs read but not started are released at once. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    for (const wake of this.sleepers) wake();
    await Promise.all(this.loops);
    this.loops = [];
  }

  onApplicationShutdown(): Promise<void> {
    return this.stop();
  }

  /**
   * Reads one batch of visible jobs from `queue` and runs them; resolves with how many it read. `match` reads only
   * jobs containing it (pgmq's `@>` filter), so a test runs only its own space's jobs.
   */
  async runOnce(queue: QueueName, match: Partial<Job> = {}): Promise<number> {
    const jobs = await this.db.serviceDb.execute<QueuedJob>(
      sql`select msg_id, read_ct, enqueued_at, message
          from pgmq.read(${queue}, ${this.config.visibilitySeconds}::int, ${this.config.batchSize}::int, ${JSON.stringify(match)}::jsonb)`,
    );
    for (const [i, job] of jobs.entries()) {
      if (this.stopping) {
        await this.release(queue, jobs.slice(i));
        break;
      }
      await this.run(queue, job);
    }
    return jobs.length;
  }

  /** Stop was asked for while the worker was running. */
  private get stopping(): boolean {
    return !this.running && this.loops.length > 0;
  }

  private async loop(queue: QueueName): Promise<void> {
    while (this.running) {
      let read = 0;
      try {
        read = await this.runOnce(queue);
      } catch (error) {
        this.logger.error(`Could not read the ${queue} queue: ${describe(error)}`);
      }
      if (!read && this.running) await this.sleep(this.config.pollMs);
    }
  }

  private async run(queue: QueueName, job: QueuedJob): Promise<void> {
    const context: JobContext = {
      queue,
      msgId: String(job.msg_id),
      attempt: job.read_ct,
      final: job.read_ct >= this.config.maxAttempts,
      enqueuedAt: job.enqueued_at,
    };
    try {
      const handler = this.handlers.find(queue, job.message?.type);
      if (!handler) throw new PermanentJobError(`No handler for "${String(job.message?.type)}" jobs on the ${queue} queue`);
      await handler(job.message, context);
    } catch (error) {
      await this.failed(queue, job, context, error);
      return;
    }
    await this.db.serviceDb.execute(sql`select pgmq.delete(${queue}, ${context.msgId}::bigint)`);
  }

  private async failed(queue: QueueName, job: QueuedJob, context: JobContext, error: unknown): Promise<void> {
    const what = `${queue} job ${context.msgId} (${String(job.message?.type)})`;
    if (!(error instanceof PermanentJobError) && !context.final) {
      const delay = retryDelaySeconds(context.attempt, this.config);
      this.logger.warn(`${what} failed on attempt ${context.attempt} of ${this.config.maxAttempts}, retrying in ${delay}s: ${describe(error)}`);
      await this.db.serviceDb.execute(sql`select pgmq.set_vt(${queue}, ${context.msgId}::bigint, ${delay}::int)`);
      return;
    }
    await this.db.transaction(async (tx) => {
      await tx.insert(jobDeadLetters).values({
        queue,
        msgId: Number(context.msgId),
        message: job.message,
        attempts: context.attempt,
        error: describe(error).slice(0, 4000),
        enqueuedAt: job.enqueued_at,
      });
      await tx.execute(sql`select pgmq.delete(${queue}, ${context.msgId}::bigint)`);
    });
    this.logger.error(`${what} gave up after ${context.attempt} attempt(s) and was dead-lettered: ${describe(error)}`);
    await this.mailer.send({
      to: this.config.alertEmails,
      subject: `Novan CMS: a ${queue} job failed`,
      text:
        `A background job failed ${context.attempt} time(s) and will not be retried.\n\n` +
        `Queue: ${queue}\nType: ${String(job.message?.type)}\nSpace: ${job.message?.spaceId ?? 'none'}\n` +
        `Queued: ${job.enqueued_at}\nError: ${describe(error)}\n\nIt is kept in job_dead_letters.`,
    });
  }

  /** Makes jobs this worker read but will not run visible to other workers again. */
  private async release(queue: QueueName, jobs: readonly QueuedJob[]): Promise<void> {
    for (const job of jobs) await this.db.serviceDb.execute(sql`select pgmq.set_vt(${queue}, ${job.msg_id}::bigint, 0)`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const wake = (): void => {
        clearTimeout(timer);
        this.sleepers.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, ms);
      this.sleepers.add(wake);
    });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
