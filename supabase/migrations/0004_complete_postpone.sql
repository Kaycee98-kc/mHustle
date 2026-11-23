-- =====================================================================
-- mHustle — update 4  (run AFTER 0003)
--  * Hustle Tasks can be ticked as completed (alerts stop; untick reopens).
--  * Feedback can record a Postpone with a new Date and Time, which moves
--    the client's Appointment (or Lesson start) and updates reminders.
-- Safe to run more than once.
-- =====================================================================

-- ------------------------------------------------ Hustle Task completion
alter table public.hustle_tasks
  add column if not exists completed boolean not null default false,
  add column if not exists completed_at timestamptz;

create or replace function public.mh_ht_before() returns trigger language plpgsql as $$
begin
  new.reminder_reference := 'mh:ht:' || new.id;
  if tg_op = 'UPDATE' then new.updated_at := now(); new.created_at := old.created_at; end if;
  if new.completed and (tg_op = 'INSERT' or not old.completed) then new.completed_at := now();
  elsif not new.completed then new.completed_at := null;
  end if;
  return new;
end $$;

create or replace function public.mh_ht_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_start timestamptz;
begin
  if new.date is null or new.completed then
    perform public.mh_apply_reminders(new.owner_id, 'hustle_task', new.id, '[]'::jsonb);
  else
    v_start := public.mh_sgt(new.date, new.time);
    perform public.mh_apply_reminders(new.owner_id, 'hustle_task', new.id,
      public.mh_four_alerts('mh:ht:' || new.id, 'Hustle Task', left(split_part(btrim(new.remarks), E'\n', 1), 80),
        'Scheduled ' || to_char(v_start at time zone 'Asia/Singapore', 'Dy DD Mon YYYY, HH12:MI AM')
        || E'\n\n' || left(new.remarks, 1500), v_start));
  end if;
  return null;
end $$;

-- ------------------------------------------------------- Postpone
alter table public.feedback
  add column if not exists postpone_date date,
  add column if not exists postpone_time time,
  add column if not exists previous_date date,
  add column if not exists previous_time time;

-- feedback text may be empty when the entry is a postponement
alter table public.feedback drop constraint if exists feedback_content_check;
alter table public.feedback drop constraint if exists feedback_content_or_postpone;
alter table public.feedback add constraint feedback_content_or_postpone
  check (length(btrim(content)) > 0 or postpone_date is not null);
alter table public.feedback drop constraint if exists feedback_postpone_pair;
alter table public.feedback add constraint feedback_postpone_pair
  check ((postpone_date is null) = (postpone_time is null));

create or replace function public.mh_feedback_before() returns trigger language plpgsql
security definer set search_path = public as $$
declare c public.clients;
begin
  if tg_op = 'INSERT' then
    if new.postpone_date is not null then
      select * into c from public.clients where id = new.client_id and owner_id = new.owner_id;
      if c.schedule_type = 'appointment' then
        new.previous_date := c.appointment_date; new.previous_time := c.appointment_time;
      elsif c.schedule_type = 'lesson' then
        new.previous_date := c.lesson_date_from; new.previous_time := c.lesson_time_from;
      else
        raise exception 'Only Appointment and Lesson clients can be postponed' using errcode = '23514';
      end if;
    end if;
  else
    new.created_at := old.created_at;  -- creation timestamp is immutable
    new.client_id := old.client_id;
    -- a recorded postponement cannot be rewritten (its schedule change already happened)
    new.postpone_date := old.postpone_date; new.postpone_time := old.postpone_time;
    new.previous_date := old.previous_date; new.previous_time := old.previous_time;
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists feedback_before on public.feedback;
create trigger feedback_before before insert or update on public.feedback
  for each row execute function public.mh_feedback_before();

create or replace function public.mh_feedback_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c public.clients;
  s public.settings;
  v_shift int;
  v_to time;
begin
  select * into c from public.clients where id = new.client_id;
  if tg_op = 'INSERT' then
    if new.postpone_date is not null then
      -- Move the schedule; the client triggers then rebuild Apple Reminders.
      if c.schedule_type = 'appointment' then
        update public.clients set appointment_date = new.postpone_date, appointment_time = new.postpone_time
         where id = c.id;
      elsif c.schedule_type = 'lesson' then
        v_shift := new.postpone_date - c.lesson_date_from;
        v_to := case when c.lesson_time_to is null then null
                     else c.lesson_time_to + (new.postpone_time - c.lesson_time_from) end;
        if v_to is not null and coalesce(c.lesson_date_to, c.lesson_date_from) = c.lesson_date_from
           and v_to < new.postpone_time then v_to := null; end if;  -- would wrap past midnight
        update public.clients set lesson_date_from = new.postpone_date,
               lesson_date_to = case when c.lesson_date_to is null then null else c.lesson_date_to + v_shift end,
               lesson_time_from = new.postpone_time, lesson_time_to = v_to
         where id = c.id;
      end if;
      -- A postponement is not a meeting outcome: no urgent follow-up is created.
    elsif c.schedule_type = 'appointment' then
      s := public.mh_settings(new.owner_id);
      insert into public.follow_up_tasks
        (owner_id, client_id, feedback_id, task_type, title, description, priority, due_at, remind_at)
      values (new.owner_id, new.client_id, new.id, 'appointment_feedback',
              'Urgent follow-up: ' || c.name || case when c.company <> '' then ' — ' || c.company else '' end,
              new.content, 'urgent', now() + make_interval(hours => s.feedback_due_hours), now())
      on conflict do nothing;
    end if;
  elsif new.content is distinct from old.content then
    update public.follow_up_tasks set description = new.content, updated_at = now()
    where feedback_id = new.id and not completed and not cancelled;
  end if;
  return null;
end $$;

-- ------------------------------------------ calendar feed: skip completed tasks
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
                        from public.hustle_tasks h
                        where h.owner_id = v_owner and h.date is not null and not h.completed), '[]'::jsonb),
    'followups', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'title', f.title, 'task_type', f.task_type,
                          'priority', f.priority, 'due_at', f.due_at, 'remind_at', f.remind_at,
                          'description', f.description, 'updated_at', f.updated_at,
                          'contact', c.contact, 'email', c.email))
                        from public.follow_up_tasks f join public.clients c on c.id = f.client_id
                        where f.owner_id = v_owner and not f.completed and not f.cancelled), '[]'::jsonb));
end $$;
grant execute on function public.mh_calendar_feed(text) to anon, authenticated;

-- ------------------------------------------- Partners & Consultants list
create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  role text not null default 'Partner' check (role in ('Partner','Consultant')),
  phone text not null default '',
  email text not null default '',
  created_at timestamptz not null default now(),
  unique (owner_id, name)
);
alter table public.partners enable row level security;
drop policy if exists owner_all on public.partners;
create policy owner_all on public.partners for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke all on public.partners from anon, authenticated;
grant select, insert, update, delete on public.partners to authenticated;
grant all on public.partners to service_role;

-- Follow-up reminders now say who should join ("With: …") or that nobody is assigned yet.
create or replace function public.mh_fut_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c public.clients;
  v_alert timestamptz;
  v_action text;
begin
  if tg_op = 'UPDATE' and new.task_type = 'initial_email' and new.completed and not old.completed then
    update public.clients set emailed = true where id = new.client_id and not emailed;
  end if;

  if new.completed or new.cancelled then
    perform public.mh_apply_reminders(new.owner_id, 'follow_up', new.id, '[]'::jsonb);
  else
    select * into c from public.clients where id = new.client_id;
    v_alert := greatest(new.remind_at, now());
    v_action := case new.task_type
      when 'initial_email' then 'Send the initial email as soon as possible.'
      when 'next_monday' then 'Follow up after the initial email.'
      else 'URGENT: follow up on appointment feedback.' end;
    perform public.mh_apply_reminders(new.owner_id, 'follow_up', new.id, jsonb_build_array(jsonb_build_object(
      'key', 'mh:fu:' || new.id,
      'list', 'Follow Up',
      'title', new.title || case when c.partner <> '' then ' (with ' || c.partner || ')' else '' end,
      'notes', v_action
        || case when c.partner <> '' then E'\nWith: ' || c.partner else E'\nNo partner assigned yet — loop someone in.' end
        || E'\nDue: ' || to_char(new.due_at at time zone 'Asia/Singapore', 'Dy DD Mon YYYY, HH12:MI AM')
        || case when c.contact <> '' then E'\nContact: ' || c.contact else '' end
        || case when c.email <> '' then E'\nEmail: ' || c.email else '' end
        || case when new.description <> '' then E'\n\n' || left(new.description, 1500) else '' end
        || E'\n\n[mh:fu:' || new.id || ']',
      'alert_at', v_alert)));
  end if;
  return null;
end $$;

-- When a client's partner changes, refresh that client's open follow-up reminders.
create or replace function public.mh_clients_partner_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.partner is distinct from old.partner then
    update public.follow_up_tasks set updated_at = now()
     where client_id = new.id and not completed and not cancelled;
  end if;
  return null;
end $$;
drop trigger if exists clients_partner_after on public.clients;
create trigger clients_partner_after after update of partner on public.clients
  for each row execute function public.mh_clients_partner_after();

-- calendar feed also carries partner on follow-ups
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
                        from public.hustle_tasks h
                        where h.owner_id = v_owner and h.date is not null and not h.completed), '[]'::jsonb),
    'followups', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'title', f.title, 'task_type', f.task_type,
                          'priority', f.priority, 'due_at', f.due_at, 'remind_at', f.remind_at,
                          'description', f.description, 'updated_at', f.updated_at,
                          'contact', c.contact, 'email', c.email, 'partner', c.partner))
                        from public.follow_up_tasks f join public.clients c on c.id = f.client_id
                        where f.owner_id = v_owner and not f.completed and not f.cancelled), '[]'::jsonb));
end $$;
grant execute on function public.mh_calendar_feed(text) to anon, authenticated;
