// POST /functions/v1/tick   (pg_cron every 15 minutes, header x-cron-secret)
// 1. Sends Web Push notifications for Follow Up tasks:
//    - initial_email + appointment_feedback: repeat every N minutes until ticked
//      (N configurable in Settings; quiet hours respected).
//    - next_monday: exactly one notification at its Monday reminder time.
// 2. Catch-up: creates the automatic weekly report if the Friday job was missed.
import webpush from "npm:web-push@3.6.7";
import { lastClosedPeriod, sgtTime } from "../_shared/time.ts";
import { admin, createReport, isCron, json } from "../_shared/server.ts";

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";
if (VAPID_PUBLIC && VAPID_PRIVATE) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

function inQuietHours(now: Date, start: string, end: string): boolean {
  const t = sgtTime(now);
  const s = start.slice(0, 5), e = end.slice(0, 5);
  if (s === e) return false;
  return s < e ? t >= s && t < e : t >= s || t < e;
}

Deno.serve(async (req) => {
  if (!isCron(req)) return json({ error: "Forbidden" }, 403);
  const db = admin();
  const now = new Date();
  const summary = { sent: 0, tasks: 0, removedSubscriptions: 0, reports: 0, errors: [] as string[] };

  // ---------------------------------------------------------------- push
  if (VAPID_PUBLIC && VAPID_PRIVATE) {
    const { data: settings } = await db.from("settings").select("*");
    for (const s of settings ?? []) {
      if (inQuietHours(now, s.quiet_start, s.quiet_end)) continue;
      const { data: subs } = await db.from("push_subscriptions").select("*").eq("owner_id", s.owner_id);
      if (!subs?.length) continue;
      const { data: tasks } = await db.from("follow_up_tasks")
        .select("id,client_id,task_type,title,priority,due_at,remind_at,last_notified_at,notify_count,notification_status")
        .eq("owner_id", s.owner_id).eq("completed", false).eq("cancelled", false).lte("remind_at", now.toISOString());

      for (const t of tasks ?? []) {
        let due = false;
        if (t.task_type === "next_monday") {
          due = t.notification_status === "pending"; // exactly once
        } else {
          const every = (t.task_type === "appointment_feedback" ? s.urgent_repeat_minutes : s.email_repeat_minutes) * 60_000;
          due = !t.last_notified_at || now.getTime() - new Date(t.last_notified_at).getTime() >= every - 60_000;
        }
        if (!due) continue;
        summary.tasks++;
        const overdue = new Date(t.due_at).getTime() < now.getTime();
        const payload = JSON.stringify({
          title: t.priority === "urgent" ? "Urgent follow-up" : t.task_type === "initial_email" ? "Email this client" : "Follow up today",
          body: `${t.title}${overdue ? " (overdue)" : ""}`,
          tag: `mh-fu-${t.id}`,
          url: `/?section=followup&task=${t.id}`,
        });
        let delivered = 0;
        for (const sub of subs) {
          try {
            await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 3600, urgency: t.priority === "urgent" ? "high" : "normal" });
            delivered++;
          } catch (e) {
            const code = (e as { statusCode?: number }).statusCode;
            if (code === 404 || code === 410) {
              await db.from("push_subscriptions").delete().eq("id", sub.id);
              summary.removedSubscriptions++;
            } else summary.errors.push(`push ${code ?? ""} ${(e as Error).message}`);
          }
        }
        if (delivered) {
          summary.sent += delivered;
          await db.from("follow_up_tasks").update({
            last_notified_at: now.toISOString(),
            notify_count: (t.notify_count ?? 0) + 1,
            notification_status: t.task_type === "next_monday" ? "sent" : "repeating",
          }).eq("id", t.id).eq("completed", false);
        }
      }
    }
  }

  // ------------------------------------------------- report catch-up
  try {
    const { start, end } = lastClosedPeriod(now);
    const { data: owners } = await db.from("settings").select("owner_id");
    for (const o of owners ?? []) {
      const r = await createReport(db, o.owner_id, start, end, "automatic");
      if (!r.skipped) summary.reports++;
    }
  } catch (e) {
    summary.errors.push(`report ${(e as Error).message}`);
  }

  return json(summary);
});
