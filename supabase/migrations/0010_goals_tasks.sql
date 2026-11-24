-- =====================================================================
-- mHustle — update 10: "Hustle Goals & Tasks"
--  * kind: Goal or Task
--  * Date From / Date To, optional Time From / Time To
--  * Consultant(s)
--  * who recorded it (from the login)
-- Apple Reminders list stays "Hustle Task". Safe to run more than once.
-- =====================================================================
alter table public.hustle_tasks
  add column if not exists kind text not null default 'task',
  add column if not exists date_to date,
  add column if not exists time_to time,
  add column if not exists partner text not null default '',
  add column if not exists created_by_email text not null default '';

alter table public.hustle_tasks drop constraint if exists hustle_tasks_kind_check;
alter table public.hustle_tasks add constraint hustle_tasks_kind_check check (kind in ('goal','task'));
alter table public.hustle_tasks drop constraint if exists hustle_tasks_date_range;
alter table public.hustle_tasks add constraint hustle_tasks_date_range
  check (date_to is null or date is null or date_to >= date);
alter table public.hustle_tasks drop constraint if exists hustle_tasks_time_range;
alter table public.hustle_tasks add constraint hustle_tasks_time_range
  check (time_to is null or time is null or coalesce(date_to, date) > date or time_to >= time);

-- who recorded it (set once, never changed by edits)
create or replace function public.mh_ht_creator() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.created_by_email, '') = '' then
      select coalesce(email, '') into new.created_by_email from auth.users where id = new.owner_id;
      new.created_by_email := coalesce(new.created_by_email, '');
    end if;
  elsif old.created_by_email <> '' then
    new.created_by_email := old.created_by_email;
  end if;
  return new;
end $$;
drop trigger if exists ht_creator on public.hustle_tasks;
create trigger ht_creator before insert or update on public.hustle_tasks
  for each row execute function public.mh_ht_creator();

update public.hustle_tasks h set created_by_email = u.email
  from auth.users u
 where u.id = h.owner_id and h.created_by_email = '' and u.email is not null;

-- reminders: "Goal: …" / "Task: …", alerts from Date From + Time From (9:00 AM if no time)
create or replace function public.mh_ht_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_start timestamptz; v_label text; v_when text;
begin
  if new.date is null or new.completed then
    perform public.mh_apply_reminders(new.owner_id, 'hustle_task', new.id, '[]'::jsonb);
  else
    v_start := public.mh_sgt(new.date, new.time);
    v_label := case new.kind when 'goal' then 'Goal: ' else 'Task: ' end
               || left(split_part(btrim(new.remarks), E'\n', 1), 80);
    v_when := to_char(new.date, 'Dy DD Mon YYYY')
              || coalesce(', ' || to_char(new.time, 'HH12:MI AM'), '')
              || case when new.date_to is not null and new.date_to <> new.date
                      then ' to ' || to_char(new.date_to, 'Dy DD Mon YYYY') else '' end
              || case when new.time_to is not null
                      then case when new.date_to is not null and new.date_to <> new.date then ', ' else ' – ' end
                           || to_char(new.time_to, 'HH12:MI AM') else '' end;
    perform public.mh_apply_reminders(new.owner_id, 'hustle_task', new.id,
      public.mh_four_alerts('mh:ht:' || new.id, 'Hustle Task', v_label,
        v_when
        || case when new.partner <> '' then E'\nConsultant: ' || new.partner else '' end
        || E'\n\n' || left(new.remarks, 1500), v_start));
  end if;
  return null;
end $$;

-- calendar feed carries the new fields
create or replace function public.mh_calendar_feed(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := public.mh_owner_from_token(p_token);
begin
  if v_owner is null then raise exception 'invalid sync token' using errcode = '28000'; end if;
  return jsonb_build_object(
    'clients', coalesce((select jsonb_agg(to_jsonb(c) - 'owner_id') from public.clients c
                          where c.schedule_type in ('appointment','lesson')), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'remarks', h.remarks, 'kind', h.kind,
                          'date', h.date, 'time', h.time, 'date_to', h.date_to, 'time_to', h.time_to,
                          'partner', h.partner, 'updated_at', h.updated_at))
                        from public.hustle_tasks h where h.date is not null and not h.completed), '[]'::jsonb),
    'followups', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'title', f.title, 'task_type', f.task_type,
                          'priority', f.priority, 'due_at', f.due_at, 'remind_at', f.remind_at,
                          'description', f.description, 'updated_at', f.updated_at,
                          'contact', c.contact, 'email', c.email, 'partner', c.partner))
                        from public.follow_up_tasks f join public.clients c on c.id = f.client_id
                        where not f.completed and not f.cancelled), '[]'::jsonb));
end $$;
grant execute on function public.mh_calendar_feed(text) to anon, authenticated;

-- refresh existing items' reminder titles
update public.hustle_tasks set updated_at = updated_at where id is not null;
