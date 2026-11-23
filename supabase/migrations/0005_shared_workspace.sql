-- =====================================================================
-- mHustle — update 5  (run AFTER 0004)
-- Shared workspace: everyone who can sign in to mHustle sees and edits the
-- same clients, feedback, follow-ups, Hustle Tasks, partners and reports.
-- Kept personal per user: settings, push notifications, calendar/sync link
-- and the Apple Reminders outbox (each person's Shortcut gets every item).
--
-- Access = having a login. Sign-ups stay disabled, so only accounts you
-- create in Supabase → Authentication → Users can see the data.
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------- shared access policies
do $$
declare t text;
begin
  foreach t in array array['clients','feedback','follow_up_tasks','hustle_tasks','weekly_reports','partners'] loop
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format('drop policy if exists team_all on public.%I', t);
    execute format('create policy team_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
-- settings, push_subscriptions and reminder_items keep their owner-only policy.

-- partner names are unique across the shared list
alter table public.partners drop constraint if exists partners_owner_id_name_key;
create unique index if not exists partners_name_unique on public.partners (lower(name));

-- one automatic report per week for the whole workspace; versions per week
drop index if exists public.wr_one_automatic;
create unique index if not exists wr_one_automatic_shared on public.weekly_reports(period_start) where generation_type = 'automatic';
alter table public.weekly_reports drop constraint if exists weekly_reports_owner_id_period_start_version_key;
create unique index if not exists wr_version_shared on public.weekly_reports(period_start, version);

-- ------------------------- Apple Reminders outbox: copy to every user
create or replace function public.mh_apply_reminders(
  p_owner uuid, p_source_type text, p_source_id uuid, p_desired jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare d jsonb; v_user uuid;
begin
  for v_user in select owner_id from public.settings loop
    for d in select * from jsonb_array_elements(coalesce(p_desired, '[]'::jsonb)) loop
      insert into public.reminder_items as r
        (owner_id, key, list_name, source_type, source_id, title, notes, alert_at, state, rev)
      values (v_user, d->>'key', d->>'list', p_source_type, p_source_id,
              d->>'title', d->>'notes', (d->>'alert_at')::timestamptz, 'active', 1)
      on conflict (owner_id, key) do update set
        list_name = excluded.list_name, title = excluded.title, notes = excluded.notes,
        alert_at = excluded.alert_at, state = 'active', rev = r.rev + 1, updated_at = now()
      where (r.list_name, r.title, r.notes, r.alert_at, r.state)
            is distinct from (excluded.list_name, excluded.title, excluded.notes, excluded.alert_at, 'active');
    end loop;
    update public.reminder_items set state = 'cancelled', rev = rev + 1, updated_at = now()
    where owner_id = v_user and source_type = p_source_type and source_id = p_source_id
      and state = 'active'
      and key not in (select e->>'key' from jsonb_array_elements(coalesce(p_desired, '[]'::jsonb)) e);
  end loop;
end $$;

-- Rebuild every user's outbox from the shared data (used when someone new
-- creates their calendar & sync link). Unchanged items are not re-sent.
create or replace function public.mh_rebuild_reminders() returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.clients set updated_at = updated_at;
  update public.hustle_tasks set updated_at = updated_at;
  update public.follow_up_tasks set updated_at = updated_at where not completed and not cancelled;
end $$;
revoke execute on function public.mh_rebuild_reminders() from public, anon, authenticated;

create or replace function public.mh_set_sync_token(p_token text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if length(p_token) < 32 then raise exception 'token too short'; end if;
  perform public.mh_settings(auth.uid());
  update public.settings set sync_token_hash = encode(digest(p_token, 'sha256'), 'hex')
  where owner_id = auth.uid();
  perform public.mh_rebuild_reminders();
end $$;
grant execute on function public.mh_set_sync_token(text) to authenticated;

-- Shortcut completions tick the shared follow-up
create or replace function public.mh_sync_completed(p_token text, p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare v_owner uuid := public.mh_owner_from_token(p_token); n int;
begin
  if v_owner is null then raise exception 'invalid sync token' using errcode = '28000'; end if;
  update public.follow_up_tasks set completed = true
   where id = any(coalesce(p_ids, '{}')) and not completed and not cancelled;
  get diagnostics n = row_count;
  return n;
end $$;

-- Calendar feed shows the whole shared workspace
create or replace function public.mh_calendar_feed(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := public.mh_owner_from_token(p_token);
begin
  if v_owner is null then raise exception 'invalid sync token' using errcode = '28000'; end if;
  return jsonb_build_object(
    'clients', coalesce((select jsonb_agg(to_jsonb(c) - 'owner_id') from public.clients c
                          where c.schedule_type in ('appointment','lesson')), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'remarks', h.remarks, 'date', h.date,
                          'time', h.time, 'updated_at', h.updated_at))
                        from public.hustle_tasks h where h.date is not null and not h.completed), '[]'::jsonb),
    'followups', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'title', f.title, 'task_type', f.task_type,
                          'priority', f.priority, 'due_at', f.due_at, 'remind_at', f.remind_at,
                          'description', f.description, 'updated_at', f.updated_at,
                          'contact', c.contact, 'email', c.email, 'partner', c.partner))
                        from public.follow_up_tasks f join public.clients c on c.id = f.client_id
                        where not f.completed and not f.cancelled), '[]'::jsonb));
end $$;
grant execute on function public.mh_calendar_feed(text) to anon, authenticated;

-- Give every existing account a settings row and a full Reminders outbox now.
insert into public.settings(owner_id) select id from auth.users on conflict do nothing;
select public.mh_rebuild_reminders();
