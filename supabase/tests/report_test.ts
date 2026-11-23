import { generateReport } from "../functions/_shared/report.ts";
import { lastClosedPeriod, nextMonday, periodFor, sgtInstant } from "../functions/_shared/time.ts";

function eq(a: unknown, b: unknown, msg: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); }
function ok(c: boolean, msg: string) { if (!c) throw new Error(msg); }

Deno.test("reporting period Sat→Fri (example from spec)", () => {
  eq(periodFor("2026-11-21"), { start: "2026-11-21", end: "2026-11-27" }, "Saturday");
  eq(periodFor("2026-11-27"), { start: "2026-11-21", end: "2026-11-27" }, "Friday");
  eq(periodFor("2026-11-28"), { start: "2026-11-28", end: "2026-12-04" }, "next Saturday");
  eq(lastClosedPeriod(sgtInstant("2026-11-27", "23:58")).start, "2026-11-14", "before 23:59");
  eq(lastClosedPeriod(sgtInstant("2026-11-27", "23:59")).start, "2026-11-21", "at 23:59");
});

Deno.test("next Monday — Monday goes +7, others to coming Monday", () => {
  eq(nextMonday(sgtInstant("2026-11-23", "10:00")), "2026-11-30", "Mon");
  eq(nextMonday(sgtInstant("2026-11-29", "23:30")), "2026-11-30", "Sun");
  eq(nextMonday(sgtInstant("2026-11-24", "00:10")), "2026-11-30", "Tue");
  eq(nextMonday(new Date("2026-11-22T16:30:00Z")), "2026-11-30", "UTC Sun = SGT Mon 00:30");
});

Deno.test("report: seven sections, no invention, evidence-based appointment status", () => {
  const txt = generateReport({
    periodStart: "2026-11-21", periodEnd: "2026-11-27", generatedAt: sgtInstant("2026-11-27", "23:59"),
    clients: [
      { id: "a", name: "Tan Wei", company: "Acme", course: "AI for Admin", partner: "Melvin", remarks: "Invoices are processed manually. Staff spend hours on data entry.", schedule_type: "appointment", appointment_date: "2026-11-24", appointment_time: "14:00" },
      { id: "b", name: "Lim", company: "Beta", course: "", partner: "", remarks: "", schedule_type: "appointment", appointment_date: "2026-11-25", appointment_time: "10:00" },
      { id: "c", name: "Ng", company: "Gamma", course: "ChatGPT Essentials", partner: "", remarks: "", schedule_type: "potential", appointment_date: null, appointment_time: null },
    ],
    feedback: [
      { id: "f1", client_id: "a", content: "Very keen on the course. Concerned about the budget for 20 staff. Asked us to send a quotation.", created_at: "2026-11-24T09:00:00Z" },
      { id: "f2", client_id: "c", content: "Not interested right now, maybe later next year.", created_at: "2026-11-26T03:00:00Z" },
      { id: "old", client_id: "a", content: "Old feedback outside period", created_at: "2026-11-10T03:00:00Z" },
    ],
    followUps: [{ client_id: "a", title: "Urgent follow-up: Tan Wei — Acme", task_type: "appointment_feedback", priority: "urgent", due_at: "2026-11-25T09:00:00Z", completed: false, completed_at: null, cancelled: false }],
  });
  console.log(txt);
  for (let i = 1; i <= 7; i++) ok(txt.includes(`${i}. `), `section ${i}`);
  ok(!txt.includes("Old feedback outside period"), "out-of-period feedback excluded");
  ok(txt.includes("not confirmed whether the meeting took place"), "Lim's appointment not assumed completed");
  ok(txt.includes("Feedback was recorded after the scheduled time"), "Acme has evidence");
  ok(txt.includes("[potential client]"), "potential feedback included");
  ok(txt.includes("Overdue (urgent)"), "missed urgent follow-up surfaced");
  ok(txt.includes("Training budget concerns"), "budget pain point");
});

Deno.test("report: empty week discloses insufficient information", () => {
  const txt = generateReport({ periodStart: "2026-11-21", periodEnd: "2026-11-27", generatedAt: new Date(), clients: [], feedback: [], followUps: [] });
  ok(txt.includes("insufficient information"), "disclosure");
});
