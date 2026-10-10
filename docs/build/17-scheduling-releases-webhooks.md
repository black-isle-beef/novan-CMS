# 17 — Scheduling, releases, webhooks and background jobs

**Phase:** 3 Scale · **Estimate:** 5 days · **Prerequisites:** 16

## Goal

Reliable background work: scheduled publish/unpublish, releases that publish many pages together, signed webhooks with retries, and housekeeping jobs.

## Tasks

1. Job infrastructure: Supabase Queues (pgmq) queues `publish`, `webhooks`, `purge`, `housekeeping`. A NestJS worker process (`apps/api` with `--worker` flag, same image) polls queues with visibility timeouts and retries with exponential back-off; dead-letter after 8 attempts with an admin alert.
2. Replace the in-process event bus from 06 with queue messages so publish side-effects (cache purge, webhooks, usage tracking) survive restarts.
3. Scheduling: `scheduled_actions (id, space_id, entry_id or release_id, action publish|unpublish, run_at, status, created_by)`. A `pg_cron` job every minute enqueues due actions. UI: "Schedule" option in the publish dialog with UK-time date picker (store UTC).
4. Releases: `releases (id, space_id, name, scheduled_at, status)` + `release_items (release_id, entry_id, version_id)`. Publishing a release is one transaction; purge runs after commit.
5. Webhooks: `webhooks (id, space_id, url, events[], secret, active)` and `webhook_deliveries (id, webhook_id, event, status, response_code, attempt, created_at)`. Payload signed with HMAC-SHA256 in `X-Novan-Signature` with a timestamp to prevent replays. Admin screen with delivery log and "resend".
6. Housekeeping: purge soft-deleted pages and assets older than 30 days, prune autosave versions older than 90 days (keep published and named versions), expire preview tokens.

## Verify

```bash
npm run db:test
npx nx test api
npx nx e2e api-e2e --grep @jobs   # schedule publish 1 min ahead -> published; webhook receiver gets signed payload; failing receiver retried
```

## As built

- Queues and the worker: `libs/api/jobs` (0014). Jobs are sent in the changing transaction; `node main.js --worker`
  runs the worker alone, `nx serve api` beside the API (`--with-worker`). Dead letters go to `job_dead_letters` and
  `JOBS_ALERT_EMAILS`.
- Scheduling (0015) and releases (0016) run as the person who scheduled them, with their role at that moment. A release
  also has an `environment_id` (its pages' environment), and names a version of each page; publishing checks every page
  first and publishes all or none.
- Webhooks (0017, `libs/api/webhooks`): the signature header is `X-Novan-Signature: t=<unix seconds>,v1=<hex
  HMAC-SHA256 of "<t>.<raw body>">`; receivers refuse timestamps more than 5 minutes off. The secret is write-only for
  client roles. Production calls only https addresses on public IPs. Client developer guide: `docs/webhooks.md`.
- Housekeeping (0018): nightly at 03:30 UTC. Signed preview tokens (package 12) are stateless and expire by their own
  signature after 15 minutes, so there is nothing stored to expire.

## Definition of done

- [ ] Killing the worker mid-job loses nothing (job reprocessed)
- [ ] Webhook signature verification example documented for client developers
