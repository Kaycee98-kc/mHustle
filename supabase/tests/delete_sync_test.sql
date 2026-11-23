\set ON_ERROR_STOP 1
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select mh_set_sync_token(repeat('ab',32));
reset role;
set role anon;
select 'pull as anon' t, jsonb_array_length(mh_sync_pull(repeat('ab',32))->'items') n;
select 'feed counts', jsonb_array_length(f->'clients') c, jsonb_array_length(f->'tasks') h, jsonb_array_length(f->'followups') fu from (select mh_calendar_feed(repeat('ab',32)) f) x;
do $$ begin perform mh_sync_pull('wrong-token-wrong-token-wrong-token-xx'); raise notice 'BAD'; exception when others then raise notice 'bad token rejected: %', sqlerrm; end $$;
do $$ begin perform * from clients; raise notice 'anon read: % rows', (select count(*) from clients); exception when others then raise notice 'anon table read blocked'; end $$;
reset role;
-- ack everything
set role anon;
select 'acked', mh_sync_ack(repeat('ab',32), (select jsonb_agg(jsonb_build_array(i->>'key',(i->>'rev')::int)) from jsonb_array_elements(mh_sync_pull(repeat('ab',32))->'items') i));
select 'pending after ack', jsonb_array_length(mh_sync_pull(repeat('ab',32))->'items');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
-- delete appointment client c1 (has feedback + follow-ups)
delete from clients where id='aaaaaaaa-0000-0000-0000-000000000001';
select 'c1 tasks left', count(*) from follow_up_tasks where client_id='aaaaaaaa-0000-0000-0000-000000000001';
select 'c1 feedback left', count(*) from feedback where client_id='aaaaaaaa-0000-0000-0000-000000000001';
-- delete hustle task
delete from hustle_tasks where id='cccccccc-0000-0000-0000-000000000001';
-- delete a follow-up
delete from follow_up_tasks where id=(select id from follow_up_tasks limit 1);
reset role;
set role anon;
select 'remove ops queued', count(*) from jsonb_array_elements(mh_sync_pull(repeat('ab',32))->'items') i where i->>'state'='cancelled';
