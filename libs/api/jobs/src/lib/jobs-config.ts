export const JOBS_CONFIG = Symbol('JOBS_CONFIG');

export interface JobsConfig {
  /**
   * How long a job read by a worker stays hidden from other workers. A worker that dies mid-job loses nothing: the job
   * reappears after this and runs again. Longer than any job should take.
   */
  visibilitySeconds: number;
  /** Tries before a job goes to the dead letters. */
  maxAttempts: number;
  /** The wait before the first retry; it doubles with each attempt, up to `retryMaxSeconds`. */
  retryBaseSeconds: number;
  retryMaxSeconds: number;
  /** How long a worker waits before reading an empty queue again. */
  pollMs: number;
  /** Jobs read from a queue at once. */
  batchSize: number;
  /** Who is emailed when a job is dead-lettered (`JOBS_ALERT_EMAILS`, comma-separated). */
  alertEmails: string[];
}

const positive = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function jobsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): JobsConfig {
  return {
    visibilitySeconds: positive(env['JOBS_VISIBILITY_SECONDS'], 120),
    maxAttempts: 8,
    retryBaseSeconds: positive(env['JOBS_RETRY_BASE_SECONDS'], 10),
    retryMaxSeconds: 3600,
    pollMs: positive(env['JOBS_POLL_MS'], 1000),
    batchSize: 10,
    alertEmails: (env['JOBS_ALERT_EMAILS'] ?? '')
      .split(',')
      .map((address) => address.trim())
      .filter(Boolean),
  };
}

/** Seconds before retrying a job that failed on `attempt` (1-based): 10, 20, 40 … up to the maximum. */
export function retryDelaySeconds(attempt: number, config: Pick<JobsConfig, 'retryBaseSeconds' | 'retryMaxSeconds'>): number {
  return Math.min(config.retryBaseSeconds * 2 ** Math.max(0, attempt - 1), config.retryMaxSeconds);
}
