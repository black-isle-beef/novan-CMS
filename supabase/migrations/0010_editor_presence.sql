-- Visual editor presence (docs/build/12-visual-editor.md, 12c): who has a page open in the visual editor, and
-- whether they are changing it, over Supabase Realtime presence. Channels are private and named
-- `editor:<space id>:<entry id>`. Only members of that space (and agency staff with a second factor) may join
-- one, see who else is there or announce themselves; nothing else goes over these channels.

-- The space a visual editor topic belongs to, or null for any other topic.
create function public.editor_topic_space(topic text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when topic ~ '^editor:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(topic, ':', 2)::uuid
  end;
$$;

revoke execute on function public.editor_topic_space(text) from public, anon;
grant execute on function public.editor_topic_space(text) to authenticated;

create policy "editor presence: members and agency staff see who is there" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'presence'
    and (
      public.editor_topic_space((select realtime.topic())) = any((select public.auth_space_ids())::uuid[])
      or (public.editor_topic_space((select realtime.topic())) is not null and (select public.is_agency_staff()))
    )
  );

create policy "editor presence: members and agency staff say they are there" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and (
      public.editor_topic_space((select realtime.topic())) = any((select public.auth_space_ids())::uuid[])
      or (public.editor_topic_space((select realtime.topic())) is not null and (select public.is_agency_staff()))
    )
  );
