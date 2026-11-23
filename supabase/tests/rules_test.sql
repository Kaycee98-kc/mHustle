-- Scenario test for the follow-up rules. Run against a scratch Postgres 15+:
--   psql -f tests/auth_stub.sql -f migrations/0001_schema.sql -f migrations/0002_sync_and_schedules.sql
--   psql -c "grant usage on schema public to authenticated; grant select,insert,update on all tables in schema public to authenticated; revoke insert, delete on follow_up_tasks from authenticated;"
--   psql -f tests/rules_test.sql
\set ON_ERROR_STOP 1
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
-- Appointment 10 days out
insert into clients(id,name,company,course,schedule_type,appointment_date,appointment_time,remarks)
values ('aaaaaaaa-0000-0000-0000-000000000001','Tan Wei','Acme','AI for Admin','appointment', current_date+10,'14:00','Manual invoicing is slow');
-- Potential not emailed
insert into clients(id,name,company,schedule_type) values ('aaaaaaaa-0000-0000-0000-000000000002','Lim','Beta','potential');
-- Lesson
insert into clients(id,name,company,schedule_type,lesson_date_from,lesson_date_to,lesson_time_from,lesson_time_to)
values ('aaaaaaaa-0000-0000-0000-000000000003','Ng','Gamma','lesson',current_date+1,current_date+2,'09:00','17:00');
select 'tasks after insert' t, task_type, priority, completed, cancelled from follow_up_tasks order by created_at;
select 'reminders' t, list_name, title, to_char(alert_at at time zone 'Asia/Singapore','YYYY-MM-DD HH24:MI') from reminder_items where state='active' order by list_name, alert_at;
-- mark potential emailed
update clients set emailed=true where id='aaaaaaaa-0000-0000-0000-000000000002';
select 'after emailed' t, task_type, completed, cancelled, to_char(due_at at time zone 'Asia/Singapore','Dy YYYY-MM-DD HH24:MI') due, to_char(remind_at at time zone 'Asia/Singapore','HH24:MI') rem from follow_up_tasks where client_id='aaaaaaaa-0000-0000-0000-000000000002';
-- edit remarks -> no duplicate monday
update clients set remarks='Interested in ChatGPT course' where id='aaaaaaaa-0000-0000-0000-000000000002';
select 'monday count (expect 1)', count(*) from follow_up_tasks where task_type='next_monday';
-- feedback for appointment -> urgent
insert into feedback(id,client_id,content) values ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Concerned about budget');
insert into feedback(client_id,content) values ('aaaaaaaa-0000-0000-0000-000000000002','Potential feedback - no task');
select 'urgent count (expect 1)', count(*) from follow_up_tasks where task_type='appointment_feedback';
update feedback set content='Concerned about budget; wants quote' where id='bbbbbbbb-0000-0000-0000-000000000001';
select 'urgent desc', description from follow_up_tasks where task_type='appointment_feedback';
-- complete urgent via app
update follow_up_tasks set completed=true where task_type='appointment_feedback';
select 'completed', completed, completed_at is not null, notification_status from follow_up_tasks where task_type='appointment_feedback';
-- try to uncomplete -> stays completed
update follow_up_tasks set completed=false where task_type='appointment_feedback';
select 'still completed', completed from follow_up_tasks where task_type='appointment_feedback';
-- new feedback after completion -> new separate task
insert into feedback(client_id,content) values ('aaaaaaaa-0000-0000-0000-000000000001','Second meeting notes');
select 'urgent total (expect 2), open (expect 1)', count(*), count(*) filter (where not completed) from follow_up_tasks where task_type='appointment_feedback';
-- tamper attempt
do $$ begin
  begin update follow_up_tasks set due_at=now() where task_type='next_monday'; raise notice 'TAMPER ALLOWED (bad)';
  exception when others then raise notice 'tamper blocked: %', sqlerrm; end; end $$;
-- uncheck emailed -> monday cancelled, initial reopened
update clients set emailed=false where id='aaaaaaaa-0000-0000-0000-000000000002';
select 'after uncheck', task_type, completed, cancelled from follow_up_tasks where client_id='aaaaaaaa-0000-0000-0000-000000000002' order by task_type;
-- complete initial email from Follow Up -> client emailed + new monday
update follow_up_tasks set completed=true where client_id='aaaaaaaa-0000-0000-0000-000000000002' and task_type='initial_email';
select 'client emailed', emailed, emailed_at is not null from clients where id='aaaaaaaa-0000-0000-0000-000000000002';
select 'mondays', completed, cancelled from follow_up_tasks where task_type='next_monday' order by created_at;
-- change potential -> appointment cancels open potential tasks
update clients set schedule_type='appointment', appointment_date=current_date+3, appointment_time='10:00' where id='aaaaaaaa-0000-0000-0000-000000000002';
select 'open potential tasks (expect 0)', count(*) from follow_up_tasks where client_id='aaaaaaaa-0000-0000-0000-000000000002' and not completed and not cancelled;
-- invalid lesson range
do $$ begin
  begin insert into clients(name,schedule_type,lesson_date_from,lesson_date_to,lesson_time_from) values ('x','lesson',current_date+5,current_date+1,'09:00'); raise notice 'BAD';
  exception when check_violation then raise notice 'lesson range blocked'; end;
  begin insert into clients(name,email,schedule_type) values ('x','bad-email','potential'); raise notice 'BAD';
  exception when check_violation then raise notice 'email blocked'; end; end $$;
-- hustle task + edit
insert into hustle_tasks(id,remarks,date,time) values ('cccccccc-0000-0000-0000-000000000001','Prepare proposal deck', current_date+8,'10:00');
update hustle_tasks set date=current_date+1 where id='cccccccc-0000-0000-0000-000000000001';
select 'ht reminders', key, state, rev from reminder_items where source_type='hustle_task' order by key;
select 'lists in use', array_agg(distinct list_name) from reminder_items;
