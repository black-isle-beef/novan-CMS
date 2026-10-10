-- Housekeeping (package 17, 0018): the nightly job, and that only the API's own connection can delete what it deletes.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select ok(
  (select count(*) = 1 from cron.job where jobname = 'housekeeping' and schedule = '30 3 * * *' and active),
  'a cron job queues housekeeping every night'
);

-- The demo space's seeded page has versions (seed.sql).
create temporary table version_under_test as
select v.id, v.entry_id from public.entry_versions v limit 1;
grant select on version_under_test to authenticated;

-- A member of the demo space, with every role there is.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000003", "role": "authenticated", "spaces": [{"id": "00000000-0000-4000-8000-000000000200", "role": "admin"}]}',
  true
);

select throws_ok($$select public.prune_autosave_versions()$$, '42501', null, 'members cannot prune versions');
select throws_ok($$select public.purge_binned_entries()$$, '42501', null, 'nor purge the bin');
select set_config('novan.pruning_autosaves', 'on', true);
select throws_ok(
  $$delete from public.entry_versions where id = (select id from version_under_test)$$,
  '42501', null, 'nor delete versions by setting the pruning flag themselves'
);

reset role;
select set_config('novan.pruning_autosaves', 'off', true);
select throws_ok(
  $$delete from public.entry_versions where id = (select id from version_under_test)$$,
  '42501', null, 'outside pruning, even the owner cannot delete a version'
);
select is(
  public.prune_autosave_versions(interval '90 days', 0),
  0,
  'the owner runs pruning'
);

select * from finish();
rollback;
