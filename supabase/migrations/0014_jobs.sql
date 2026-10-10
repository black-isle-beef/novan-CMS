-- 0014 Background jobs (docs/build/17-scheduling-releases-webhooks.md): Supabase Queues (pgmq) for the work the API's
-- worker process (`node main.js --worker`) does after a change commits, and the jobs that kept failing.
--
-- A job is sent in the same transaction as the change that causes it, so a committed change always has its job and a
-- rolled-back one never does. The worker reads a job with a visibility timeout: if the worker dies mid-job, the job
-- becomes visible again when the timeout ends and is run again, so handlers are idempotent. A failed job is retried
-- with exponential back-off; after 8 attempts it moves to `job_dead_letters` and the agency is alerted.
--
--   publish       scheduled publishing and unpublishing (0015), releases
--   purge         CDN purges after content, redirects, locales, files or API tokens change
--   webhooks      webhook deliveries
--   housekeeping  purging the bin, pruning autosaves, expiring preview tokens

create extension if not exists pgmq;

select pgmq.create('publish');
select pgmq.create('purge');
select pgmq.create('webhooks');
select pgmq.create('housekeeping');

-- Only the API's own connection (the owner) uses the queues: no client role reads, sends or deletes jobs.
revoke all on schema pgmq from public, anon, authenticated, service_role;
revoke all on all tables in schema pgmq from public, anon, authenticated, service_role;
revoke all on all sequences in schema pgmq from public, anon, authenticated, service_role;
revoke execute on all functions in schema pgmq from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Jobs that failed every attempt (or could never run), kept for the agency to look into. Not tenant data: RLS is on
-- with no policies, so only the owner's connection reads or writes it.
-- ---------------------------------------------------------------------------
create table public.job_dead_letters (
  id uuid primary key default gen_random_uuid(),
  queue text not null,
  msg_id bigint not null,
  message jsonb not null,
  attempts integer not null check (attempts >= 0),
  error text not null,
  enqueued_at timestamptz not null,
  failed_at timestamptz not null default now()
);

create index job_dead_letters_failed_at_idx on public.job_dead_letters (failed_at desc);

alter table public.job_dead_letters enable row level security;
revoke all on public.job_dead_letters from public, anon, authenticated, service_role;
