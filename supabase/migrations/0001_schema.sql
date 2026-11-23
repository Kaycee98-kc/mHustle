-- =====================================================================
-- mHustle — database schema (Supabase Postgres)
-- All business rules for follow-ups and the Apple Reminders outbox are
-- enforced here with triggers so they behave identically from iPhone,
-- Windows, the scheduled jobs and the Apple Shortcut.
-- Scheduling is interpreted in Asia/Singapore (UTC+8, no DST).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Settings (one row per user; single-user app)
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  owner_id uuid primary key default auth.uid() references auth.users on delete cascade,
  urgent_repeat_minutes   int  not null default 240 check (urgent_repeat_minutes >= 15),
  email_repeat_minutes    int  not null default 240 check (email_repeat_minutes >= 15),
  feedback_due_hours      int  not null default 24  check (feedback_due_hours >= 1),
  initial_email_due_hours int  not null default 24  check (initial_email_due_hours >= 1),
  monday_reminder_time    time not null default '09:00',
  quiet_start             time not null default '22:00',
  quiet_end               time not null default '08:00',
  sync_token_hash         text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  name     text not null check (length(btrim(name)) > 0),
  company  text not null default '',
  address  text not null default '',
  contact  text not null default '',
  email    text not null default '',
  course   text not null default '',
  partner  text not null default '',
  remarks  text not null default '',
  schedule_type text not null check (schedule_type in ('appointment','lesson','potential')),
  appointment_date date,
  appointment_time time,
  lesson_date_from date,
  lesson_date_to   date,
  lesson_time_from time,
  lesson_time_to   time,
  emailed    boolean not null default false,
  emailed_at timestamptz,
  reminder_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_format check (email = '' or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint appointment_fields check (
    schedule_type <> 'appointment' or (appointment_date is not null and appointment_time is not null)),
  constraint lesson_fields check (
    schedule_type <> 'lesson' or (lesson_date_from is not null and lesson_time_from is not null)),
  constraint lesson_range check (
    lesson_date_to is null or lesson_date_from is null or lesson_date_to >= lesson_date_from),
  constraint lesson_time_range check (
    lesson_time_to is null or lesson_time_from is null
    or coalesce(lesson_date_to, lesson_date_from) > lesson_date_from
    or lesson_time_to >= lesson_time_from)
);
create index if not exists clients_owner_idx on public.clients(owner_id);

-- ---------------------------------------------------------------------
-- Feedback (never overwritten by new entries; one row per entry)
-- ---------------------------------------------------------------------
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  content text not null check (length(btrim(content)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists feedback_client_idx on public.feedback(client_id);

-- ---------------------------------------------------------------------
-- Follow-up tasks (generated automatically, never deleted)
-- ---------------------------------------------------------------------
create table if not exists public.follow_up_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  feedback_id uuid references public.feedback(id) on delete set null,
  task_type text not null check (task_type in ('initial_email','next_monday','appointment_feedback')),
  title text not null,
  description text not null default '',
  priority text not null check (priority in ('urgent','high','normal')),
  anchor_at timestamptz,             -- next_monday: the emailed_at it was created from
  due_at timestamptz not null,
  remind_at timestamptz not null,
  completed boolean not null default false,
  completed_at timestamptz,
  cancelled boolean not null default false,  -- e.g. Emailed un-ticked / schedule type changed
  reminder_reference text,
  notification_status text not null default 'pending'
    check (notification_status in ('pending','repeating','sent','stopped')),
  last_notified_at timestamptz,
  notify_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fut_owner_idx on public.follow_up_tasks(owner_id);
create index if not exists fut_client_idx on public.follow_up_tasks(client_id);
-- Duplicate prevention
create unique index if not exists fut_one_per_feedback
  on public.follow_up_tasks(feedback_id) where task_type = 'appointment_feedback';
create unique index if not exists fut_one_open_initial_email
  on public.follow_up_tasks(client_id) where task_type = 'initial_email' and not completed and not cancelled;
create unique index if not exists fut_one_monday_per_anchor
  on public.follow_up_tasks(client_id, anchor_at) where task_type = 'next_monday';
create unique index if not exists fut_one_open_monday
  on public.follow_up_tasks(client_id) where task_type = 'next_monday' and not completed and not cancelled;

-- ---------------------------------------------------------------------
-- Hustle Tasks
-- ---------------------------------------------------------------------
create table if not exists public.hustle_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  remarks text not null check (length(btrim(remarks)) > 0),
  date date,
  time time,
  reminder_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ht_owner_idx on public.hustle_tasks(owner_id);

-- ---------------------------------------------------------------------
-- Weekly reports (versions preserved; one automatic report per period)
-- ---------------------------------------------------------------------
create table if not exists public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  period_start date not null,
  period_end date not null,
  generated_at timestamptz not null default now(),
  generation_type text not null check (generation_type in ('automatic','manual')),
  generator text not null default 'rule-based' check (generator in ('rule-based','ai')),
  content text not null,
  version int not null,
  status text not null default 'generated' check (status in ('generated','failed')),
  unique (owner_id, period_start, version)
);
create unique index if not exists wr_one_automatic
  on public.weekly_reports(owner_id, period_start) where generation_type = 'automatic';

-- ---------------------------------------------------------------------
-- Apple Reminders outbox — consumed by the iOS Shortcut.
-- Exactly three list names are allowed.
-- ---------------------------------------------------------------------
create table if not exists public.reminder_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  key text not null,
  list_name text not null check (list_name in ('Clients','Follow Up','Hustle Task')),
  source_type text not null check (source_type in ('client','follow_up','hustle_task')),
  source_id uuid not null,
  title text not null,
  notes text not null default '',
  alert_at timestamptz not null,
  state text not null default 'active' check (state in ('active','cancelled')),
  rev int not null default 1,
  synced_rev int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, key)
);
create index if not exists ri_pending_idx on public.reminder_items(owner_id) where rev > synced_rev;

-- ---------------------------------------------------------------------
-- Web Push subscriptions
-- ---------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now()
);

-- =====================================================================
-- Row Level Security: every table is private to its owner.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['settings','clients','feedback','follow_up_tasks','hustle_tasks',
                           'weekly_reports','reminder_items','push_subscriptions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format('create policy owner_all on public.%I for all to authenticated
                    using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
  end loop;
end $$;

-- Follow-up tasks are created by triggers only; the app may only tick them.
revoke insert, delete on public.follow_up_tasks from anon, authenticated;
revoke insert, update, delete on public.reminder_items from anon, authenticated;
revoke all on public.clients, public.feedback, public.follow_up_tasks, public.hustle_tasks,
  public.weekly_reports, public.reminder_items, public.push_subscriptions, public.settings from anon;

-- =====================================================================
-- Helpers
-- =====================================================================
create or replace function public.mh_sgt(d date, t time) returns timestamptz
language sql immutable as $$ select ((d + coalesce(t, time '09:00')) at time zone 'Asia/Singapore') $$;

create or replace function public.mh_settings(p_owner uuid) returns public.settings
language plpgsql security definer set search_path = public as $$
declare s public.settings;
begin
  select * into s from public.settings where owner_id = p_owner;
  if not found then
    insert into public.settings(owner_id) values (p_owner) on conflict do nothing;
    select * into s from public.settings where owner_id = p_owner;
  end if;
  return s;
end $$;

create or replace function public.mh_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- Next Monday strictly after the given Singapore date (Monday -> +7 days)
create or replace function public.mh_next_monday(p_ts timestamptz) returns date
language sql immutable as $$
  select (p_ts at time zone 'Asia/Singapore')::date
         + (8 - extract(isodow from (p_ts at time zone 'Asia/Singapore')::date))::int
$$;

-- Upsert a desired set of reminder items for one source; cancel the rest.
create or replace function public.mh_apply_reminders(
  p_owner uuid, p_source_type text, p_source_id uuid, p_desired jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  for d in select * from jsonb_array_elements(coalesce(p_desired, '[]'::jsonb)) loop
    insert into public.reminder_items as r
      (owner_id, key, list_name, source_type, source_id, title, notes, alert_at, state, rev)
    values (p_owner, d->>'key', d->>'list', p_source_type, p_source_id,
            d->>'title', d->>'notes', (d->>'alert_at')::timestamptz, 'active', 1)
    on conflict (owner_id, key) do update set
      list_name = excluded.list_name, title = excluded.title, notes = excluded.notes,
      alert_at = excluded.alert_at, state = 'active', rev = r.rev + 1, updated_at = now()
    where (r.list_name, r.title, r.notes, r.alert_at, r.state)
          is distinct from (excluded.list_name, excluded.title, excluded.notes, excluded.alert_at, 'active');
  end loop;

  update public.reminder_items set state = 'cancelled', rev = rev + 1, updated_at = now()
  where owner_id = p_owner and source_type = p_source_type and source_id = p_source_id
    and state = 'active'
    and key not in (select e->>'key' from jsonb_array_elements(coalesce(p_desired, '[]'::jsonb)) e);
end $$;

-- Four alerts (7d, 2d, 1d, 2h) before a start time; alerts already past are skipped.
create or replace function public.mh_four_alerts(
  p_prefix text, p_list text, p_title text, p_notes text, p_start timestamptz)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', p_prefix || ':' || a.label,
           'list', p_list,
           'title', p_title || ' (' || a.human || ')',
           'notes', p_notes || E'\n\n[' || p_prefix || ':' || a.label || ']',
           'alert_at', p_start - a.offs) order by a.offs desc), '[]'::jsonb)
  from (values ('7d', interval '7 days', 'in 7 days'),
               ('2d', interval '2 days', 'in 2 days'),
               ('1d', interval '1 day',  'tomorrow'),
               ('2h', interval '2 hours','in 2 hours')) as a(label, offs, human)
  where p_start - a.offs > now()
$$;

-- =====================================================================
-- Clients: emailed_at bookkeeping, reminders, potential-client follow-ups
-- =====================================================================
create or replace function public.mh_clients_before() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.reminder_reference := 'mh:client:' || new.id;
    new.emailed_at := case when new.emailed then now() end;
  else
    new.updated_at := now();
    new.reminder_reference := 'mh:client:' || new.id;
    if new.emailed and not old.emailed then new.emailed_at := now();
    elsif not new.emailed then new.emailed_at := null;
    else new.emailed_at := old.emailed_at;
    end if;
  end if;
  -- clear fields that do not belong to the chosen schedule type
  if new.schedule_type <> 'appointment' then new.appointment_date := null; new.appointment_time := null; end if;
  if new.schedule_type <> 'lesson' then
    new.lesson_date_from := null; new.lesson_date_to := null;
    new.lesson_time_from := null; new.lesson_time_to := null;
  end if;
  return new;
end $$;

create or replace function public.mh_clients_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s public.settings := public.mh_settings(new.owner_id);
  v_label text := new.name || case when new.company <> '' then ' — ' || new.company else '' end;
  v_start timestamptz;
  v_monday date;
begin
  -- 1) Apple Reminders list "Clients": appointments and lessons only
  if new.schedule_type = 'appointment' then
    v_start := public.mh_sgt(new.appointment_date, new.appointment_time);
    perform public.mh_apply_reminders(new.owner_id, 'client', new.id,
      public.mh_four_alerts('mh:client:' || new.id, 'Clients', 'Appointment: ' || v_label,
        'Appointment ' || to_char(v_start at time zone 'Asia/Singapore', 'Dy DD Mon YYYY, HH12:MI AM')
        || case when new.course <> '' then E'\nCourse: ' || new.course else '' end
        || case when new.address <> '' then E'\nAddress: ' || new.address else '' end
        || case when new.partner <> '' then E'\nPartner: ' || new.partner else '' end, v_start));
  elsif new.schedule_type = 'lesson' then
    v_start := public.mh_sgt(new.lesson_date_from, new.lesson_time_from);
    perform public.mh_apply_reminders(new.owner_id, 'client', new.id,
      public.mh_four_alerts('mh:client:' || new.id, 'Clients', 'Lesson: ' || v_label,
        'Lesson from ' || to_char(v_start at time zone 'Asia/Singapore', 'Dy DD Mon YYYY, HH12:MI AM')
        || coalesce(' to ' || to_char(coalesce(new.lesson_date_to, new.lesson_date_from), 'Dy DD Mon YYYY')
           || coalesce(', ' || to_char(new.lesson_time_to, 'HH12:MI AM'), ''), '')
        || case when new.course <> '' then E'\nCourse: ' || new.course else '' end
        || case when new.address <> '' then E'\nAddress: ' || new.address else '' end
        || case when new.partner <> '' then E'\nPartner: ' || new.partner else '' end, v_start));
  else
    perform public.mh_apply_reminders(new.owner_id, 'client', new.id, '[]'::jsonb);
  end if;

  -- 2) Potential-client follow-up rules
  if new.schedule_type = 'potential' then
    if not new.emailed then
      -- Initial-email task: one open task at a time (history is never reopened)
      update public.follow_up_tasks
         set title = 'Send initial email to ' || v_label, description = new.remarks
       where client_id = new.id and task_type = 'initial_email' and not completed and not cancelled
         and (title <> 'Send initial email to ' || v_label or description <> new.remarks);
      if not found and not exists (select 1 from public.follow_up_tasks where client_id = new.id
           and task_type = 'initial_email' and not completed and not cancelled) then
        insert into public.follow_up_tasks
          (owner_id, client_id, task_type, title, description, priority, due_at, remind_at)
        values (new.owner_id, new.id, 'initial_email', 'Send initial email to ' || v_label,
                new.remarks, 'high', now() + make_interval(hours => s.initial_email_due_hours), now())
        on conflict do nothing;
      end if;
      -- Emailed was un-ticked: cancel the pending next-Monday follow-up
      update public.follow_up_tasks set cancelled = true, notification_status = 'stopped', updated_at = now()
      where client_id = new.id and task_type = 'next_monday' and not completed and not cancelled;
    else
      -- Emailed: complete the initial-email action
      update public.follow_up_tasks
         set completed = true, completed_at = coalesce(new.emailed_at, now()),
             notification_status = 'stopped', updated_at = now()
      where client_id = new.id and task_type = 'initial_email' and not completed and not cancelled;
      -- One follow-up for the next Monday (never recurring)
      v_monday := public.mh_next_monday(new.emailed_at);
      insert into public.follow_up_tasks
        (owner_id, client_id, task_type, title, description, priority, anchor_at, due_at, remind_at)
      values (new.owner_id, new.id, 'next_monday', 'Follow up with ' || v_label, new.remarks, 'normal',
              new.emailed_at, public.mh_sgt(v_monday, time '23:59'), public.mh_sgt(v_monday, s.monday_reminder_time))
      on conflict do nothing;
      update public.follow_up_tasks set title = 'Follow up with ' || v_label, description = new.remarks
      where client_id = new.id and task_type = 'next_monday' and not completed and not cancelled
        and (title <> 'Follow up with ' || v_label or description <> new.remarks);
    end if;
  else
    -- No longer a potential client: cancel open potential-client actions
    update public.follow_up_tasks set cancelled = true, notification_status = 'stopped', updated_at = now()
    where client_id = new.id and task_type in ('initial_email','next_monday') and not completed and not cancelled;
  end if;
  return null;
end $$;

drop trigger if exists clients_before on public.clients;
create trigger clients_before before insert or update on public.clients
  for each row execute function public.mh_clients_before();
drop trigger if exists clients_after on public.clients;
create trigger clients_after after insert or update on public.clients
  for each row execute function public.mh_clients_after();

-- =====================================================================
-- Feedback: urgent follow-up for Appointment clients
-- =====================================================================
create or replace function public.mh_feedback_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c public.clients;
  s public.settings;
begin
  select * into c from public.clients where id = new.client_id;
  if tg_op = 'INSERT' then
    if c.schedule_type = 'appointment' then
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

create or replace function public.mh_feedback_before() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;  -- creation timestamp is immutable
    new.client_id := old.client_id;
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists feedback_before on public.feedback;
create trigger feedback_before before update on public.feedback
  for each row execute function public.mh_feedback_before();
drop trigger if exists feedback_after on public.feedback;
create trigger feedback_after after insert or update on public.feedback
  for each row execute function public.mh_feedback_after();

-- =====================================================================
-- Follow-up tasks: completion bookkeeping, Emailed sync, reminders
-- =====================================================================
create or replace function public.mh_fut_before() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.reminder_reference := 'mh:fu:' || new.id;
    return new;
  end if;
  new.updated_at := now();
  -- completed tasks stay completed (history is never reopened)
  if old.completed and not new.completed then
    new.completed := true; new.completed_at := old.completed_at;
  elsif new.completed and not old.completed then
    new.completed_at := coalesce(new.completed_at, now());
    new.notification_status := 'stopped';
  end if;
  return new;
end $$;

create or replace function public.mh_fut_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c public.clients;
  v_alert timestamptz;
  v_action text;
begin
  -- Ticking the initial-email task in Follow Up == ticking Emailed on the client
  if tg_op = 'UPDATE' and new.task_type = 'initial_email' and new.completed and not old.completed then
    update public.clients set emailed = true where id = new.client_id and not emailed;
  end if;

  -- Apple Reminders list "Follow Up": one reminder per open task
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
      'title', new.title,
      'notes', v_action
        || E'\nDue: ' || to_char(new.due_at at time zone 'Asia/Singapore', 'Dy DD Mon YYYY, HH12:MI AM')
        || case when c.contact <> '' then E'\nContact: ' || c.contact else '' end
        || case when c.email <> '' then E'\nEmail: ' || c.email else '' end
        || case when new.description <> '' then E'\n\n' || left(new.description, 1500) else '' end
        || E'\n\n[mh:fu:' || new.id || ']',
      'alert_at', v_alert)));
  end if;
  return null;
end $$;

drop trigger if exists fut_before on public.follow_up_tasks;
create trigger fut_before before insert or update on public.follow_up_tasks
  for each row execute function public.mh_fut_before();
drop trigger if exists fut_after on public.follow_up_tasks;
create trigger fut_after after insert or update on public.follow_up_tasks
  for each row execute function public.mh_fut_after();

-- The app may only change completion on follow-up tasks
create or replace function public.mh_fut_guard() returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' then
    if (new.client_id, new.feedback_id, new.task_type, new.due_at, new.priority, new.cancelled, new.anchor_at)
       is distinct from (old.client_id, old.feedback_id, old.task_type, old.due_at, old.priority, old.cancelled, old.anchor_at)
       and pg_trigger_depth() = 1 then
      raise exception 'Only the completion checkbox can be changed on a follow-up task';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists fut_guard on public.follow_up_tasks;
create trigger fut_guard before update on public.follow_up_tasks
  for each row execute function public.mh_fut_guard();

-- =====================================================================
-- Hustle Tasks: Apple Reminders list "Hustle Task"
-- =====================================================================
create or replace function public.mh_ht_before() returns trigger language plpgsql as $$
begin
  new.reminder_reference := 'mh:ht:' || new.id;
  if tg_op = 'UPDATE' then new.updated_at := now(); new.created_at := old.created_at; end if;
  return new;
end $$;

create or replace function public.mh_ht_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_start timestamptz;
begin
  if new.date is null then
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

drop trigger if exists ht_before on public.hustle_tasks;
create trigger ht_before before insert or update on public.hustle_tasks
  for each row execute function public.mh_ht_before();
drop trigger if exists ht_after on public.hustle_tasks;
create trigger ht_after after insert or update on public.hustle_tasks
  for each row execute function public.mh_ht_after();

-- updated_at for settings
drop trigger if exists settings_touch on public.settings;
create trigger settings_touch before update on public.settings
  for each row execute function public.mh_touch();

-- =====================================================================
-- RPC: set the Apple Shortcut sync token (stores only a SHA-256 hash)
-- =====================================================================
create or replace function public.mh_set_sync_token(p_token text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if length(p_token) < 32 then raise exception 'token too short'; end if;
  perform public.mh_settings(auth.uid());
  update public.settings set sync_token_hash = encode(digest(p_token, 'sha256'), 'hex')
  where owner_id = auth.uid();
end $$;
revoke execute on function public.mh_set_sync_token(text) from anon;

