-- =====================================================================
-- mHustle — update 6  (run AFTER 0005)
-- Action Done gets a "WhatsApp" tick next to "Emailed". Either one counts as
-- the first contact: it completes the initial-contact task and schedules the
-- single next-Monday follow-up (anchored to the first contact time).
-- Safe to run more than once.
-- =====================================================================
alter table public.clients
  add column if not exists whatsapped boolean not null default false,
  add column if not exists whatsapped_at timestamptz;

create or replace function public.mh_clients_before() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.reminder_reference := 'mh:client:' || new.id;
    new.emailed_at := case when new.emailed then now() end;
    new.whatsapped_at := case when new.whatsapped then now() end;
  else
    new.updated_at := now();
    new.reminder_reference := 'mh:client:' || new.id;
    if new.emailed and not old.emailed then new.emailed_at := now();
    elsif not new.emailed then new.emailed_at := null;
    else new.emailed_at := old.emailed_at;
    end if;
    if new.whatsapped and not old.whatsapped then new.whatsapped_at := now();
    elsif not new.whatsapped then new.whatsapped_at := null;
    else new.whatsapped_at := old.whatsapped_at;
    end if;
  end if;
  -- clear fields that do not belong to the chosen schedule type
  if new.schedule_type <> 'appointment' then new.appointment_date := null; new.appointment_time := null; end if;
  if new.schedule_type <> 'lesson' then
    new.lesson_date_from := null; new.lesson_date_to := null;
    new.lesson_time_from := null; new.lesson_time_to := null;
  end if;
  return new;
end $$;

create or replace function public.mh_clients_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s public.settings := public.mh_settings(new.owner_id);
  v_label text := new.name || case when new.company <> '' then ' — ' || new.company else '' end;
  v_start timestamptz;
  v_monday date;
  v_contacted boolean := new.emailed or new.whatsapped;
  v_contacted_at timestamptz := least(new.emailed_at, new.whatsapped_at);  -- first contact (NULLs ignored)
begin
  -- 1) Apple Reminders list "Clients": appointments and lessons only
  if new.schedule_type = 'appointment' then
    v_start := public.mh_sgt(new.appointment_date, new.appointment_time);
    perform public.mh_apply_reminders(new.owner_id, 'client', new.id,
      public.mh_four_alerts('mh:client:' || new.id, 'Clients', 'Appointment: ' || v_label,
        'Appointment ' || to_char(v_start at time zone 'Asia/Singapore', 'Dy DD Mon YYYY, HH12:MI AM')
        || case when new.course <> '' then E'\nCourse: ' || new.course else '' end
        || case when new.address <> '' then E'\nAddress: ' || new.address else '' end
        || case when new.partner <> '' then E'\nPartner: ' || new.partner else '' end, v_start));
  elsif new.schedule_type = 'lesson' then
    v_start := public.mh_sgt(new.lesson_date_from, new.lesson_time_from);
    perform public.mh_apply_reminders(new.owner_id, 'client', new.id,
      public.mh_four_alerts('mh:client:' || new.id, 'Clients', 'Lesson: ' || v_label,
        'Lesson from ' || to_char(v_start at time zone 'Asia/Singapore', 'Dy DD Mon YYYY, HH12:MI AM')
        || coalesce(' to ' || to_char(coalesce(new.lesson_date_to, new.lesson_date_from), 'Dy DD Mon YYYY')
           || coalesce(', ' || to_char(new.lesson_time_to, 'HH12:MI AM'), ''), '')
        || case when new.course <> '' then E'\nCourse: ' || new.course else '' end
        || case when new.address <> '' then E'\nAddress: ' || new.address else '' end
        || case when new.partner <> '' then E'\nPartner: ' || new.partner else '' end, v_start));
  else
    perform public.mh_apply_reminders(new.owner_id, 'client', new.id, '[]'::jsonb);
  end if;

  -- 2) Potential-client follow-up rules
  if new.schedule_type = 'potential' then
    if not v_contacted then
      -- Initial-email task: one open task at a time (history is never reopened)
      update public.follow_up_tasks
         set title = 'Contact ' || v_label || ' (email or WhatsApp)', description = new.remarks
       where client_id = new.id and task_type = 'initial_email' and not completed and not cancelled
         and (title <> 'Contact ' || v_label || ' (email or WhatsApp)' or description <> new.remarks);
      if not found and not exists (select 1 from public.follow_up_tasks where client_id = new.id
           and task_type = 'initial_email' and not completed and not cancelled) then
        insert into public.follow_up_tasks
          (owner_id, client_id, task_type, title, description, priority, due_at, remind_at)
        values (new.owner_id, new.id, 'initial_email', 'Contact ' || v_label || ' (email or WhatsApp)',
                new.remarks, 'high', now() + make_interval(hours => s.initial_email_due_hours), now())
        on conflict do nothing;
      end if;
      -- Emailed was un-ticked: cancel the pending next-Monday follow-up
      update public.follow_up_tasks set cancelled = true, notification_status = 'stopped', updated_at = now()
      where client_id = new.id and task_type = 'next_monday' and not completed and not cancelled;
    else
      -- Emailed or WhatsApp'd: complete the initial-contact action
      update public.follow_up_tasks
         set completed = true, completed_at = coalesce(v_contacted_at, now()),
             notification_status = 'stopped', updated_at = now()
      where client_id = new.id and task_type = 'initial_email' and not completed and not cancelled;
      -- One follow-up for the next Monday (never recurring)
      v_monday := public.mh_next_monday(v_contacted_at);
      insert into public.follow_up_tasks
        (owner_id, client_id, task_type, title, description, priority, anchor_at, due_at, remind_at)
      values (new.owner_id, new.id, 'next_monday', 'Follow up with ' || v_label, new.remarks, 'normal',
              v_contacted_at, public.mh_sgt(v_monday, time '23:59'), public.mh_sgt(v_monday, s.monday_reminder_time))
      on conflict do nothing;
      update public.follow_up_tasks set title = 'Follow up with ' || v_label, description = new.remarks
      where client_id = new.id and task_type = 'next_monday' and not completed and not cancelled
        and (title <> 'Follow up with ' || v_label or description <> new.remarks);
    end if;
  else
    -- No longer a potential client: cancel open potential-client actions
    update public.follow_up_tasks set cancelled = true, notification_status = 'stopped', updated_at = now()
    where client_id = new.id and task_type in ('initial_email','next_monday') and not completed and not cancelled;
  end if;
  return null;
end $$;

