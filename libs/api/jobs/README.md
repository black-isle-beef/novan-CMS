# api-jobs

Background jobs on Supabase Queues (pgmq), package 17. The queues and the dead-letter table are created in
`supabase/migrations/0014_jobs.sql`.

| Queue | Jobs |
| --- | --- |
| `publish` | `scheduled-action`: a scheduled publish or unpublish of a page, or a release's publish, come due (`@novan/api-content`, 0015, 0016) |
| `purge` | `content-changed`, `media-changed`, `token-revoked`: CDN purges (`@novan/api-delivery`) |
| `webhooks` | `dispatch` (a change, fanned out to subscribed webhooks) and `deliver` (one signed request) (`@novan/api-webhooks`) |
| `housekeeping` | `purge-bin`, `prune-autosaves` (`@novan/api-content`) and `purge-assets` (`@novan/api-media`), queued by pg_cron at 03:30 UTC (0018) |

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
