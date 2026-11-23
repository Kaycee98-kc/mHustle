// Apple Reminders bridge for the "mHustle Sync" iOS/macOS Shortcut.
// Browsers cannot reach Apple Reminders, so the Shortcut (which can) pulls
// pending changes from here and applies them to exactly three lists:
//   Clients · Follow Up · Hustle Task
//
// Auth: header  x-mhustle-token: <token shown once in mHustle Settings>
//
// GET                                   → { count, ops:[...], ack }
//     op "add":    delete any reminder whose Notes contain `key`, then add a new one
//     op "remove": delete any reminder whose Notes contain `key`
// POST { "action":"ack", "ack": "<ack from GET>" }       → marks those ops as applied
// POST { "action":"completed", "text": "<notes of reminders completed in Reminders>" }
//     → ticks the matching Follow Up tasks in mHustle (completion sync back)
import { admin, cors, json, sha256Hex } from "../_shared/server.ts";

const BATCH = 40;
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function alertText(iso: string): string {
  // Singapore wall clock, en-US wording that Shortcuts parses reliably
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} at ${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const token = req.headers.get("x-mhustle-token") ?? "";
  if (token.length < 32) return json({ error: "Missing sync token" }, 401);
  const db = admin();
  const { data: s } = await db.from("settings").select("owner_id").eq("sync_token_hash", await sha256Hex(token)).maybeSingle();
  if (!s) return json({ error: "Invalid sync token" }, 401);
  const owner = s.owner_id as string;

  if (req.method === "GET") {
    // Cancelled items that never reached Reminders need no work: acknowledge silently.
    await db.rpc("mh_ack_unsynced_cancelled", { p_owner: owner });
    const { data, error } = await db.rpc("mh_pending_reminders", { p_owner: owner });
    if (error) return json({ error: error.message }, 500);
    const all = (data ?? []) as { key: string; list_name: string; title: string; notes: string; alert_at: string; state: string; rev: number; synced_rev: number }[];
    const pending = all.slice(0, BATCH);
    const ops = pending.map((r) => r.state === "active"
      ? { op: "add", key: r.key, list: r.list_name, title: r.title, notes: r.notes, alert: r.alert_at, alert_text: alertText(r.alert_at) }
      : { op: "remove", key: r.key, list: r.list_name });
    const ack = btoa(JSON.stringify(pending.map((r) => [r.key, r.rev])));
    return json({ count: ops.length, more: all.length > BATCH, ops, ack });
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (body.action === "ack" && typeof body.ack === "string") {
      let pairs: [string, number][] = [];
      try { pairs = JSON.parse(atob(body.ack)); } catch { return json({ error: "Bad ack" }, 400); }
      let n = 0;
      for (const [key, rev] of pairs) {
        // Only acknowledge the revision that was delivered; later edits stay pending.
        const { count } = await db.from("reminder_items").update({ synced_rev: rev }, { count: "exact" })
          .eq("owner_id", owner).eq("key", key).eq("rev", rev);
        n += count ?? 0;
      }
      return json({ acknowledged: n });
    }
    if (body.action === "completed" && typeof body.text === "string") {
      const ids = [...new Set([...body.text.matchAll(/mh:fu:([0-9a-f-]{36})/gi)].map((m) => m[1].toLowerCase()))];
      let n = 0;
      for (const id of ids) {
        const { count } = await db.from("follow_up_tasks").update({ completed: true }, { count: "exact" })
          .eq("owner_id", owner).eq("id", id).eq("completed", false);
        n += count ?? 0;
      }
      return json({ completed: n });
    }
    return json({ error: "Unknown action" }, 400);
  }
  return json({ error: "Method not allowed" }, 405);
});
