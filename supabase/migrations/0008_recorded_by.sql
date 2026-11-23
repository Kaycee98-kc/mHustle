-- =====================================================================
-- mHustle — update 8: remember who recorded each client, so All Clients
-- can be filtered by the person who entered it. Safe to run more than once.
-- =====================================================================
alter table public.clients add column if not exists created_by_email text not null default '';

create or replace function public.mh_clients_creator() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.created_by_email, '') = '' then
    select coalesce(email, '') into new.created_by_email from auth.users where id = new.owner_id;
    new.created_by_email := coalesce(new.created_by_email, '');
  end if;
  return new;
end $$;

drop trigger if exists clients_creator on public.clients;
create trigger clients_creator before insert on public.clients
  for each row execute function public.mh_clients_creator();

-- the recorder never changes when the client is edited later
create or replace function public.mh_clients_creator_keep() returns trigger language plpgsql as $$
begin
  new.created_by_email := old.created_by_email;
  return new;
end $$;
drop trigger if exists clients_creator_keep on public.clients;
create trigger clients_creator_keep before update of created_by_email on public.clients
  for each row when (old.created_by_email <> '') execute function public.mh_clients_creator_keep();

-- tag existing clients from their creator's login
update public.clients c set created_by_email = u.email
  from auth.users u
 where u.id = c.owner_id and c.created_by_email = '' and u.email is not null;
