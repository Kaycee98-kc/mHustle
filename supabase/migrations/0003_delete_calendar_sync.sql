-- =====================================================================
-- mHustle — update 3
--  * Delete clients, follow-ups and Hustle Tasks (their Apple Reminders
--    are cancelled so the Shortcut removes them).
--  * Token-checked functions used by the app's own /api routes on Vercel:
--      - Apple Reminders sync (no Supabase CLI needed)
--      - Subscribed iPhone/Mac calendar feed
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------- delete
grant delete on public.clients, public.follow_up_tasks, public.hustle_tasks to authenticated;

create or replace function public.mh_on_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.mh_apply_reminders(old.owner_id, tg_argv[0], old.id, '[]'::jsonb);
  return old;
end $$;

drop trigger if exists clients_delete on public.clients;
create trigger clients_delete after delete on public.clients
  for each row execute function public.mh_on_delete('client');
drop trigger if exists fut_delete on public.follow_up_tasks;
create trigger fut_delete after delete on public.follow_up_tasks
  for each row execute function public.mh_on_delete('follow_up');
drop trigger if exists ht_delete on public.hustle_tasks;
create trigger ht_delete after delete on public.hustle_tasks
  for each row execute function public.mh_on_delete('hustle_task');

-- The completion-only guard must not block the automatic "feedback removed"
-- update that happens while a client (and its feedback) is being deleted.
create or replace function public.mh_fut_guard() returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' and pg_trigger_depth() = 1 then
    if (new.client_id, new.task_type, new.due_at, new.priority, new.cancelled, new.anchor_at)
       is distinct from (old.client_id, old.task_type, old.due_at, old.priority, old.cancelled, old.anchor_at)
       or (new.feedback_id is distinct from old.feedback_id and new.feedback_id is not null) then
      raise exception 'Only the completion checkbox can be changed on a follow-up task';
    end if;
  end if;
  return new;
end $$;

-- ------------------------------------------------------- token helpers
create or replace function public.mh_owner_from_token(p_token text) returns uuid
language sql stable security definer set search_path = public, extensions as $$
  select owner_id from public.settings
  where p_token is not null and length(p_token) >= 32
    and sync_token_hash = encode(digest(p_token, 'sha256'), 'hex')
  limit 1
$$;
revoke execute on function public.mh_owner_from_token(text) from public, anon, authenticated;

-- ------------------------------------------------ Apple Reminders sync
create or replace function public.mh_sync_pull(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid := public.mh_owner_from_token(p_token); v jsonb; v_total int;
begin
  if v_owner is null then raise exception 'invalid sync token' using errcode = '28000'; end if;
  update public.reminder_items set synced_rev = rev
   where owner_id = v_owner and state = 'cancelled' and synced_rev = 0 and rev > synced_rev;
  select count(*) into v_total from public.reminder_items where owner_id = v_owner and rev > synced_rev;
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', key, 'list', list_name, 'title', title, 'notes', notes,
           'alert', alert_at, 'state', state, 'rev', rev) order by updated_at, key), '[]'::jsonb)
    into v
    from (select * from public.reminder_items where owner_id = v_owner and rev > synced_rev
          order by updated_at, key limit 40) r;
  return jsonb_build_object('items', v, 'more', v_total > 40);
end $$;

create or replace function public.mh_sync_ack(p_token text, p_pairs jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_owner uuid := public.mh_owner_from_token(p_token); n int;
begin
  if v_owner is null then raise exception 'invalid sync token' using errcode = '28000'; end if;
  update public.reminder_items r set synced_rev = (p->>1)::int
    from jsonb_array_elements(coalesce(p_pairs, '[]'::jsonb)) p
   where r.owner_id = v_owner and r.key = p->>0 and r.rev = (p->>1)::int;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.mh_sync_completed(p_token text, p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare v_owner uuid := public.mh_owner_from_token(p_token); n int;
begin
  if v_owner is null then raise exception 'invalid sync token' using errcode = '28000'; end if;
  update public.follow_up_tasks set completed = true
   where owner_id = v_owner and id = any(coalesce(p_ids, '{}')) and not completed and not cancelled;
  get diagnostics n = row_count;
  return n;
end $$;

-- ------------------------------------------------------- calendar feed
create or replace function public.mh_calendar_feed(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := public.mh_owner_from_token(p_token);
begin
  if v_owner is null then raise exception 'invalid sync token' using errcode = '28000'; end if;
  return jsonb_build_object(
    'clients', coalesce((select jsonb_agg(to_jsonb(c) - 'owner_id') from public.clients c
                          where c.owner_id = v_owner and c.schedule_type in ('appointment','lesson')), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'remarks', h.remarks, 'date', h.date,
                          'time', h.time, 'updated_at', h.updated_at))
                        from public.hustle_tasks h where h.owner_id = v_owner and h.date is not null), '[]'::jsonb),
    'followups', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'title', f.title, 'task_type', f.task_type,
                          'priority', f.priority, 'due_at', f.due_at, 'remind_at', f.remind_at,
                          'description', f.description, 'updated_at', f.updated_at,
                          'contact', c.contact, 'email', c.email))
                        from public.follow_up_tasks f join public.clients c on c.id = f.client_id
                        where f.owner_id = v_owner and not f.completed and not f.cancelled), '[]'::jsonb));
end $$;

revoke execute on function public.mh_sync_pull(text), public.mh_sync_ack(text, jsonb),
  public.mh_sync_completed(text, uuid[]), public.mh_calendar_feed(text) from public;
grant execute on function public.mh_sync_pull(text), public.mh_sync_ack(text, jsonb),
  public.mh_sync_completed(text, uuid[]), public.mh_calendar_feed(text) to anon, authenticated;
