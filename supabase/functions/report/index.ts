// POST /functions/v1/report
//  - Scheduled (pg_cron, Friday 23:59 SGT): header x-cron-secret → automatic report
//    for the period that has just closed, for every account. Never duplicates.
//  - Manual (from the app, signed-in JWT): body { periodStart: "YYYY-MM-DD" } → new
//    version for that period. Earlier versions are always preserved.
import { addDays, lastClosedPeriod, periodFor } from "../_shared/time.ts";
import { admin, cors, createReport, isCron, json, userFromJwt } from "../_shared/server.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const db = admin();

  try {
    if (isCron(req)) {
      const { start, end } = lastClosedPeriod(new Date());
      const { data: owners, error } = await db.from("settings").select("owner_id");
      if (error) throw error;
      const results = [];
      for (const o of owners ?? []) results.push(await createReport(db, o.owner_id, start, end, "automatic"));
      return json({ period: { start, end }, results });
    }

    const owner = await userFromJwt(req);
    if (!owner) return json({ error: "Not signed in" }, 401);
    const body = await req.json().catch(() => ({}));
    const ps = typeof body.periodStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.periodStart) ? body.periodStart : null;
    if (!ps) return json({ error: "periodStart (YYYY-MM-DD) is required" }, 400);
    const { start } = periodFor(ps); // normalise to the Saturday
    const result = await createReport(db, owner, start, addDays(start, 6), "manual");
    return json(result);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
