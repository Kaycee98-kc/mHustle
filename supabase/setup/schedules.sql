-- =====================================================================
-- mHustle — scheduled jobs (run ONCE in the Supabase SQL Editor,
-- after deploying the Edge Functions). Replace the two placeholders.
-- pg_cron runs in UTC:  Friday 15:59 UTC  =  Friday 23:59 Singapore time.
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1) Secrets (stored encrypted in Supabase Vault)
select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co', 'mh_project_url');
select vault.create_secret('PASTE-THE-SAME-CRON_SECRET-YOU-SET-FOR-THE-FUNCTIONS', 'mh_cron_secret');

-- 2) Automatic weekly report: every Friday 23:59 SGT
select cron.schedule('mhustle-friday-report', '59 15 * * 5', $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'mh_project_url') || '/functions/v1/report',
    headers := jsonb_build_object('Content-Type', 'application/json',
               'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mh_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$);

-- 3) Follow Up notifications + report catch-up: every 15 minutes
select cron.schedule('mhustle-tick', '*/15 * * * *', $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'mh_project_url') || '/functions/v1/tick',
    headers := jsonb_build_object('Content-Type', 'application/json',
               'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mh_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$);

-- Check:   select * from cron.job;
-- History: select * from cron.job_run_details order by start_time desc limit 20;
