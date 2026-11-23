\set ON_ERROR_STOP 1
-- two accounts: A (existing data) and B (colleague)
insert into auth.users values ('22222222-2222-2222-2222-222222222222') on conflict do nothing;
\i migrations/0005_shared_workspace.sql
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select 'B sees clients', count(*) from clients;
select 'B sees partners', count(*) from partners;
insert into partners(name,role) values ('Bonnie','Partner');
insert into clients(id,name,schedule_type,appointment_date,appointment_time,partner) values ('ffffffff-0000-0000-0000-000000000001','Made by B','appointment',current_date+9,'11:00','Bonnie');
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select 'A sees B client', count(*) from clients where id='ffffffff-0000-0000-0000-000000000001';
select 'A sees partner Bonnie', count(*) from partners where name='Bonnie';
update clients set remarks='edited by A' where id='ffffffff-0000-0000-0000-000000000001';
do $$ begin insert into partners(name) values ('bonnie'); raise notice 'BAD dup'; exception when unique_violation then raise notice 'duplicate partner blocked'; end $$;
select 'A settings rows visible (expect 1)', count(*) from settings;
reset role;
select 'outbox per user for B client', owner_id, count(*) from reminder_items where source_id='ffffffff-0000-0000-0000-000000000001' and state='active' group by owner_id order by 2;
select 'outbox totals per user', owner_id, count(*) filter (where state='active') from reminder_items group by owner_id;
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
delete from clients where id='ffffffff-0000-0000-0000-000000000001';
reset role;
select 'after delete, active for that client (expect 0)', count(*) from reminder_items where source_id='ffffffff-0000-0000-0000-000000000001' and state='active';
