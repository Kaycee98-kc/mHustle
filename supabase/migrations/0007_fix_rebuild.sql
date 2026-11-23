-- =====================================================================
-- mHustle — update 7: fix "UPDATE requires a WHERE clause" when creating the
-- calendar & sync link (Supabase blocks unfiltered updates). Safe to re-run.
-- =====================================================================
create or replace function public.mh_rebuild_reminders() returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.clients set updated_at = updated_at where id is not null;
  update public.hustle_tasks set updated_at = updated_at where id is not null;
  update public.follow_up_tasks set updated_at = updated_at where id is not null and not completed and not cancelled;
end $$;
revoke execute on function public.mh_rebuild_reminders() from public, anon, authenticated;
