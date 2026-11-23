-- Minimal stand-in for Supabase auth (local testing only — do NOT run on Supabase)
do $$ begin create role anon; create role authenticated; create role service_role bypassrls; exception when others then null; end $$;
create schema auth; create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
insert into auth.users values ('11111111-1111-1111-1111-111111111111','kenneth.choo@hustle.com.sg');
