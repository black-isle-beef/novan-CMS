# api-jobs

Background jobs on Supabase Queues (pgmq), package 17. The queues and the dead-letter table are created in
`supabase/migrations/0014_jobs.sql`.

| Queue | Jobs |
| --- | --- |
| `publish` | `scheduled-action`: a scheduled publish or unpublish come due (`@novan/api-content`, 0015_scheduling.sql) |
| `purge` | `content-changed`, `media-changed`, `token-revoked`: CDN purges (`@novan/api-delivery`) |
| `webhooks` | webhook deliveries |
| `housekeeping` | purging the bin, pruning autosaves, expiring preview tokens |

- **Sending.** `enqueue(tx, queue, job)` sends in the caller's transaction, so a job exists exactly when its change
  commits. It works inside `DbService.userDb` too (it steps out of the `authenticated` role for the send).
- **Handling.** Feature modules register a handler per queue and job `type` on `JobHandlers` when they start. A
  handler resolves to finish the job, or throws to retry it. Jobs can run twice, so handlers are idempotent.
- **Running.** `JobWorker` reads each queue in a loop with a visibility timeout (`JOBS_VISIBILITY_SECONDS`, 120). A
  failed job is retried after 10 s, 20 s, 40 s … (`JOBS_RETRY_BASE_SECONDS`); after 8 attempts, or on a
  `PermanentJobError`, it moves to `job_dead_letters` and `JOBS_ALERT_EMAILS` are emailed. If the worker dies
  mid-job, the job reappears when its timeout ends and runs again.
- **Processes.** `node main.js --worker` runs only the worker (same image as the API); `nx serve api` runs it beside
  the HTTP server (`--with-worker`). Production runs the API without a worker, plus one or more worker processes.

Run `nx test api-jobs`, and `nx test api` (`apps/api/src/app/jobs.spec.ts`, against the local database).
