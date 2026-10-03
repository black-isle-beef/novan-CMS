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

## Definition of done

- [ ] Killing the worker mid-job loses nothing (job reprocessed)
- [ ] Webhook signature verification example documented for client developers
