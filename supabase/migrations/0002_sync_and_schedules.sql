-- =====================================================================
-- mHustle — service functions used by the Edge Functions
-- (callable only with the service role key, never from the browser)
-- =====================================================================
create or replace function public.mh_pending_reminders(p_owner uuid)
returns setof public.reminder_items language sql stable security definer set search_path = public as $$
  select * from public.reminder_items
  where owner_id = p_owner and rev > synced_rev
  order by updated_at, key
$$;

create or replace function public.mh_ack_unsynced_cancelled(p_owner uuid)
returns void language sql security definer set search_path = public as $$
  -- a reminder that was cancelled before it ever reached Apple Reminders needs no removal
  update public.reminder_items set synced_rev = rev
  where owner_id = p_owner and state = 'cancelled' and synced_rev = 0 and rev > synced_rev
$$;

revoke execute on function public.mh_pending_reminders(uuid) from public, anon, authenticated;
revoke execute on function public.mh_ack_unsynced_cancelled(uuid) from public, anon, authenticated;
grant execute on function public.mh_pending_reminders(uuid), public.mh_ack_unsynced_cancelled(uuid) to service_role;
