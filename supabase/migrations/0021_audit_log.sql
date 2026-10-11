-- 0021 Audit log screen (docs/build/18-search-forms-audit.md): space admins read their space's audit trail (0002,
-- 0004), newest first, filtered by person, action and date, a page at a time. These indexes serve those filters; the
-- table and who may read it are unchanged.

create index audit_events_space_actor_created_at_idx on public.audit_events (space_id, actor_id, created_at desc, id desc);
create index audit_events_space_action_created_at_idx on public.audit_events (space_id, action, created_at desc, id desc);
