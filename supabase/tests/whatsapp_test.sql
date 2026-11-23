\set ON_ERROR_STOP 1
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
insert into clients(id,name,company,schedule_type) values ('99999999-0000-0000-0000-000000000001','Wa Client','WaCo','potential');
select 'open initial', count(*) from follow_up_tasks where client_id='99999999-0000-0000-0000-000000000001' and task_type='initial_email' and not completed;
update clients set whatsapped=true where id='99999999-0000-0000-0000-000000000001';
select 'after WhatsApp: initial done / monday open', bool_and(completed) filter (where task_type='initial_email'), count(*) filter (where task_type='next_monday' and not completed and not cancelled) from follow_up_tasks where client_id='99999999-0000-0000-0000-000000000001';
update clients set emailed=true where id='99999999-0000-0000-0000-000000000001';
select 'after also Emailed: mondays (expect 1)', count(*) from follow_up_tasks where client_id='99999999-0000-0000-0000-000000000001' and task_type='next_monday' and not cancelled;
update clients set whatsapped=false where id='99999999-0000-0000-0000-000000000001';
select 'untick WA, still emailed: open mondays (expect 1), open initial (expect 0)', count(*) filter (where task_type='next_monday' and not completed and not cancelled), count(*) filter (where task_type='initial_email' and not completed and not cancelled) from follow_up_tasks where client_id='99999999-0000-0000-0000-000000000001';
update clients set emailed=false where id='99999999-0000-0000-0000-000000000001';
select 'untick both: open initial (expect 1), open monday (expect 0)', count(*) filter (where task_type='initial_email' and not completed and not cancelled), count(*) filter (where task_type='next_monday' and not completed and not cancelled) from follow_up_tasks where client_id='99999999-0000-0000-0000-000000000001';
select 'whatsapped_at cleared', whatsapped_at is null from clients where id='99999999-0000-0000-0000-000000000001';
