-- =====================================================================
-- mHustle — update 9: daily summary push notification (about 8 AM SGT).
-- Vercel's daily scheduler calls /api/daily-digest with a secret; these
-- functions check that secret and hand back what the summary needs.
--
-- BEFORE RUNNING: replace PASTE_YOUR_CRON_SECRET_HERE (near the bottom) with
-- the CRON_SECRET value from mhustle-secrets.txt — the same value you add
-- to Vercel as CRON_SECRET. Safe to run more than once.
-- =====================================================================

-- per-person on/off switch (default on)
alter table public.settings add column if not exists daily_digest boolean not null default true;

-- server secrets (stored only as SHA-256 hashes; never readable by the app)
create table if not exists public.app_secrets (name text primary key, hash text not null);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

create or replace function public.mh_cron_ok(p_secret text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.app_secrets
                 where name = 'cron' and p_secret is not null and length(p_secret) >= 32
                   and hash = encode(digest(p_secret, 'sha256'), 'hex'))
$$;
revoke execute on function public.mh_cron_ok(text) from public, anon, authenticated;

-- Everything the daily summary needs: today's appointments/lessons, open
-- follow-ups, and the devices of everyone who has the daily summary on.
create or replace function public.mh_daily_digest(p_secret text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_today date := (now() at time zone 'Asia/Singapore')::date;
begin
  if not public.mh_cron_ok(p_secret) then raise exception 'invalid cron secret' using errcode = '28000'; end if;
  return jsonb_build_object(
    'today', v_today,
    'subs', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'endpoint', p.endpoint, 'p256dh', p.p256dh, 'auth', p.auth))
                       from public.push_subscriptions p join public.settings s on s.owner_id = p.owner_id
                      where s.daily_digest), '[]'::jsonb),
    'clients', coalesce((select jsonb_agg(jsonb_build_object(
                          'name', c.name, 'company', c.company, 'partner', c.partner, 'schedule_type', c.schedule_type,
                          'appointment_date', c.appointment_date, 'appointment_time', c.appointment_time,
                          'lesson_date_from', c.lesson_date_from, 'lesson_date_to', c.lesson_date_to,
                          'lesson_time_from', c.lesson_time_from))
                        from public.clients c
                       where (c.schedule_type = 'appointment' and c.appointment_date = v_today)
                          or (c.schedule_type = 'lesson' and v_today between c.lesson_date_from
                              and coalesce(c.lesson_date_to, c.lesson_date_from))), '[]'::jsonb),
    'followups', coalesce((select jsonb_agg(jsonb_build_object('title', f.title, 'due_at', f.due_at, 'priority', f.priority))
                          from public.follow_up_tasks f where not f.completed and not f.cancelled), '[]'::jsonb));
end $$;

create or replace function public.mh_drop_push_subscription(p_secret text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.mh_cron_ok(p_secret) then raise exception 'invalid cron secret' using errcode = '28000'; end if;
  delete from public.push_subscriptions where id = p_id;
end $$;

revoke execute on function public.mh_daily_digest(text), public.mh_drop_push_subscription(text, uuid) from public;
grant execute on function public.mh_daily_digest(text), public.mh_drop_push_subscription(text, uuid) to anon, authenticated;

-- ▼▼▼ replace the placeholder with your CRON_SECRET, keep the quotes ▼▼▼
insert into public.app_secrets (name, hash)
values ('cron', encode(extensions.digest('PASTE_YOUR_CRON_SECRET_HERE', 'sha256'), 'hex'))
on conflict (name) do update set hash = excluded.hash;
