// Server-only helpers for Supabase Edge Functions (Deno).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { generateReport, type ReportInput } from "./report.ts";

export const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-mhustle-token, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

export function admin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

/** Constant-time compare for shared secrets. */
export function safeEqual(a: string | null, b: string | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function isCron(req: Request): boolean {
  return safeEqual(req.headers.get("x-cron-secret"), Deno.env.get("CRON_SECRET"));
}

/** Resolve the signed-in user from the request's JWT. */
export async function userFromJwt(req: Request): Promise<string | null> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data, error } = await admin().auth.getUser(jwt);
  return error ? null : data.user?.id ?? null;
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- reports
async function loadReportData(db: SupabaseClient, _owner: string) {
  const [c, f, t] = await Promise.all([
    // shared workspace: reports cover everyone's records
    db.from("clients").select("id,name,company,course,partner,remarks,schedule_type,appointment_date,appointment_time"),
    db.from("feedback").select("id,client_id,content,created_at"),
    db.from("follow_up_tasks").select("client_id,title,task_type,priority,due_at,completed,completed_at,cancelled"),
  ]);
  const err = c.error ?? f.error ?? t.error;
  if (err) throw new Error(err.message);
  return { clients: c.data!, feedback: f.data!, followUps: t.data! };
}

/** Optional AI rewrite. Disabled unless AI_REPORTS=on and ANTHROPIC_API_KEY are set. */
async function aiRewrite(draft: string): Promise<string | null> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (Deno.env.get("AI_REPORTS") !== "on" || !key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("AI_MODEL") ?? "claude-haiku-4-5",
        max_tokens: 4000,
        system:
          "You edit weekly sales-activity reports into polished professional business English. " +
          "Keep exactly the seven numbered sections and their order. Use ONLY facts present in the draft. " +
          "Never invent conversations, outcomes, opinions, numbers or commitments. Never state a scheduled " +
          "appointment took place unless the draft says feedback was recorded afterwards. Keep recommendations " +
          "clearly labelled as recommendations. Keep statements of insufficient information. Output plain text only.",
        messages: [{ role: "user", content: draft }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.content?.[0]?.text;
    return typeof text === "string" && text.includes("7.") ? text.trim() + "\n" : null;
  } catch {
    return null;
  }
}

export async function createReport(
  db: SupabaseClient, owner: string, periodStart: string, periodEnd: string, type: "automatic" | "manual",
) {
  if (type === "automatic") {
    const { data: existing } = await db.from("weekly_reports").select("id")
      .eq("period_start", periodStart).eq("generation_type", "automatic").maybeSingle();
    if (existing) return { skipped: true, id: existing.id };
  }
  const data = await loadReportData(db, owner);
  const input: ReportInput = { periodStart, periodEnd, generatedAt: new Date(), ...data } as ReportInput;
  let content: string;
  let generator: "rule-based" | "ai" = "rule-based";
  let status: "generated" | "failed" = "generated";
  try {
    content = generateReport(input);
    const ai = await aiRewrite(content);
    if (ai) { content = ai; generator = "ai"; }
  } catch (e) {
    content = `Report generation failed: ${(e as Error).message}`;
    status = "failed";
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: last } = await db.from("weekly_reports").select("version")
      .eq("period_start", periodStart).order("version", { ascending: false }).limit(1).maybeSingle();
    const version = (last?.version ?? 0) + 1;
    const { data: row, error } = await db.from("weekly_reports").insert({
      owner_id: owner, period_start: periodStart, period_end: periodEnd, generation_type: type,
      generator, content, version, status,
    }).select().single();
    if (!error) return { skipped: false, report: row };
    if (error.code !== "23505") throw new Error(error.message);
    if (type === "automatic") return { skipped: true }; // another run already created it
  }
  throw new Error("Could not allocate a report version");
}
