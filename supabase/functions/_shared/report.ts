// Rule-based weekly report generator.
// It only restates and quotes what is in the records — it never invents
// conversations, outcomes or opinions, and it never treats a scheduled
// appointment as a completed meeting unless feedback supports it.

import { addDays, longDate, sgtDate, sgtDateTime, sgtInstant, shortDate, time12 } from "./time.ts";

export interface ReportClient {
  id: string;
  name: string;
  company: string;
  course: string;
  partner: string;
  remarks: string;
  schedule_type: "appointment" | "lesson" | "potential";
  appointment_date: string | null;
  appointment_time: string | null;
}
export interface ReportFeedback {
  id: string;
  client_id: string;
  content: string;
  created_at: string;
}
export interface ReportFollowUp {
  client_id: string;
  title: string;
  task_type: string;
  priority: string;
  due_at: string;
  completed: boolean;
  completed_at: string | null;
  cancelled: boolean;
}
export interface ReportInput {
  periodStart: string; // Saturday YYYY-MM-DD
  periodEnd: string; // Friday YYYY-MM-DD
  generatedAt: Date;
  clients: ReportClient[]; // all clients (used to resolve feedback owners)
  feedback: ReportFeedback[]; // all feedback (filtered here by created_at)
  followUps: ReportFollowUp[]; // all follow-up tasks
}

// ------------------------------------------------------------------ helpers
const sentenceSplit = (t: string) =>
  t.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim().replace(/^[-•*]\s*/, "")).filter((s) => s.length > 2);

const label = (c: { name: string; company: string }) => (c.company ? `${c.name} (${c.company})` : c.name);
const quote = (s: string) => `“${s.length > 260 ? s.slice(0, 257).trimEnd() + "…" : s}”`;
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const list = (items: string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

export const PAIN_POINTS: { name: string; re: RegExp }[] = [
  { name: "Repetitive administrative workflows", re: /repetitiv|\bmanual(ly)?\b|admin(istrative)?\b|data entry|paperwork|copy[- ]?paste|spreadsheet|excel/i },
  { name: "Manual document processing", re: /document|invoice|\bpdfs?\b|\bforms?\b|filing|scann|contracts?\b|reports? writing/i },
  { name: "Operational inefficiencies", re: /inefficien|\bslow\b|time[- ]consuming|bottleneck|delay|backlog|overtime|takes (too )?long|waste/i },
  { name: "Training budget concerns", re: /budget|\bcosts?\b|pric(e|ing)|expensive|fund(ing)?\b|grant|skillsfuture|\bsfec\b|afford|subsid/i },
  { name: "Workforce development requirements", re: /upskill|reskill|workforce|staff (training|development)|talent|manpower|headcount|competenc|skills? gap/i },
  { name: "Reservations about AI adoption", re: /((concern|worr|hesitan|reluctan|skeptic|sceptic|unsure|risk|privacy|security|afraid|resist)[^.]{0,60}\b(ai|chatgpt|copilot|automation)\b)|(\b(ai|chatgpt|copilot|automation)\b[^.]{0,60}(concern|worr|risk|privacy|security|hesitan|reluctan|confidential))/i },
  { name: "Uncertainty about training outcomes", re: /\broi\b|return on investment|outcomes?\b|\bresults?\b|effectiveness|measur|worth it|value for money/i },
];

const OBJECTION = /not interested|no budget|too expensive|declin|reject|object|not (the )?right time|not now|maybe later|no need|already (have|has|engaged)|not keen|won'?t|cannot commit|can'?t commit/i;
const CONCERN = /concern|worr|hesitan|unsure|reserv|doubt|issue|problem|risk|unclear|question(ed|s)? (about|on)|afraid|sceptic|skeptic/i;
const POSITIVE = /interest|keen|positive|happy|satisf|\bgood\b|great|\blike[ds]?\b|agree|confirm|proceed|excit|impress|useful|helpful|appreciat|enjoy|well received/i;
const SUGGESTION = /suggest|recommend|would like|prefer|request|propos|wish|asked (for|if|whether|about)|hope/i;
const REQ_CHANGE = /chang|instead|now want|revis|additional|increase|reduce|more (staff|pax|participants|sessions)|fewer|reschedul|postpone|switch/i;
const FOLLOWUP_DISC = /follow[- ]?up|next step|call back|get back|send (a |the )?(quote|quotation|proposal|deck|brochure|details|info)|quotation|\bquote\b|proposal|another meeting|second meeting|meet again/i;
const CONFIRMED = /\bconfirm(ed)?\b|signed|enrol(l)?ed|registered|\bpo\b|purchase order|paid|booked|committed/i;
const TRAINING_TEXT = /course|training|programme|program\b|workshop|class|session|upskill|\bai\b|chatgpt|copilot|automation|prompt/i;

function matches(text: string, re: RegExp) {
  return sentenceSplit(text).filter((s) => re.test(s));
}

// ------------------------------------------------------------------ main
export function generateReport(input: ReportInput): string {
  const { periodStart, periodEnd, generatedAt } = input;
  const startAt = sgtInstant(periodStart, "00:00").getTime();
  const endAt = sgtInstant(addDays(periodEnd, 1), "00:00").getTime();
  const byId = new Map(input.clients.map((c) => [c.id, c]));

  const appointments = input.clients
    .filter((c) => c.schedule_type === "appointment" && c.appointment_date &&
      c.appointment_date >= periodStart && c.appointment_date <= periodEnd)
    .sort((a, b) => `${a.appointment_date}${a.appointment_time}`.localeCompare(`${b.appointment_date}${b.appointment_time}`));

  const feedback = input.feedback
    .filter((f) => { const t = new Date(f.created_at).getTime(); return t >= startAt && t < endAt && byId.has(f.client_id); })
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const fbClient = (f: ReportFeedback) => byId.get(f.client_id)!;
  const potentialFeedback = feedback.filter((f) => fbClient(f).schedule_type === "potential");

  // Appointment status — evidence based
  const apptStatus = (c: ReportClient) => {
    const at = sgtInstant(c.appointment_date!, c.appointment_time ?? "00:00");
    if (at.getTime() > generatedAt.getTime()) return "upcoming";
    const fbAfter = input.feedback.some((f) => f.client_id === c.id && new Date(f.created_at).getTime() >= at.getTime());
    return fbAfter ? "feedback" : "unconfirmed";
  };
  const statuses = appointments.map((c) => ({ c, s: apptStatus(c) }));
  const nFeedbackAppt = statuses.filter((x) => x.s === "feedback").length;
  const nUnconfirmed = statuses.filter((x) => x.s === "unconfirmed").length;
  const nUpcoming = statuses.filter((x) => x.s === "upcoming").length;

  // Feedback classification
  type Cls = { c: ReportClient; f: ReportFeedback; s: string };
  const cls: Record<string, Cls[]> = { positive: [], concern: [], objection: [], suggestion: [], change: [], followup: [] };
  for (const f of feedback) {
    for (const s of sentenceSplit(f.content)) {
      const c = fbClient(f);
      if (OBJECTION.test(s)) cls.objection.push({ c, f, s });
      else if (CONCERN.test(s)) cls.concern.push({ c, f, s });
      else if (POSITIVE.test(s)) cls.positive.push({ c, f, s });
      if (SUGGESTION.test(s)) cls.suggestion.push({ c, f, s });
      if (REQ_CHANGE.test(s)) cls.change.push({ c, f, s });
      if (FOLLOWUP_DISC.test(s)) cls.followup.push({ c, f, s });
    }
  }

  // Pain points from appointment remarks + feedback this period
  const sources: { c: ReportClient; text: string; where: string }[] = [
    ...appointments.map((c) => ({ c, text: c.remarks, where: "appointment remarks" })),
    ...feedback.map((f) => ({ c: fbClient(f), text: f.content, where: `feedback of ${shortDate(sgtDate(new Date(f.created_at)))}` })),
  ];
  const pains = PAIN_POINTS.map((p) => ({
    name: p.name,
    hits: sources.flatMap((src) => matches(src.text, p.re).map((s) => ({ ...src, s }))),
  })).filter((p) => p.hits.length);

  // Training interests
  const engaged = new Map<string, ReportClient>();
  appointments.forEach((c) => engaged.set(c.id, c));
  feedback.forEach((f) => engaged.set(f.client_id, fbClient(f)));
  const courseMap = new Map<string, ReportClient[]>();
  for (const c of engaged.values()) {
    if (!c.course.trim()) continue;
    const k = c.course.trim();
    courseMap.set(k, [...(courseMap.get(k) ?? []), c]);
  }
  const confirmedSentences = feedback.flatMap((f) => matches(f.content, CONFIRMED).filter((s) => TRAINING_TEXT.test(s)).map((s) => ({ c: fbClient(f), s })));
  const trainingMentions = sources.flatMap((src) => matches(src.text, TRAINING_TEXT).map((s) => ({ ...src, s })))
    .filter((x) => !confirmedSentences.some((y) => y.s === x.s));

  // Follow-ups
  const now = generatedAt.getTime();
  const open = input.followUps.filter((t) => !t.completed && !t.cancelled);
  const missed = open.filter((t) => new Date(t.due_at).getTime() < now);
  const pending = open.filter((t) => new Date(t.due_at).getTime() >= now);
  const completedThisWeek = input.followUps.filter((t) => t.completed && t.completed_at &&
    new Date(t.completed_at).getTime() >= startAt && new Date(t.completed_at).getTime() < endAt);

  const out: string[] = [];
  const h = (t: string) => out.push("", t, "-".repeat(t.length));
  const p = (t: string) => out.push(t);
  const b = (t: string) => out.push(`• ${t}`);

  out.push("mHustle Weekly Report");
  out.push(`Reporting period: ${longDate(periodStart)} to ${longDate(periodEnd)}`);
  out.push(`Generated: ${sgtDateTime(generatedAt.toISOString())} (Singapore time)`);

  // 1 ------------------------------------------------------------------
  h("1. Executive Summary");
  if (!appointments.length && !feedback.length) {
    p("No appointments or client feedback were recorded in mHustle for this reporting period, so there is insufficient information to assess client engagement for the week.");
  } else {
    const parts: string[] = [];
    if (appointments.length) {
      let s = `${plural(appointments.length, "appointment was", "appointments were")} scheduled during the period`;
      const det: string[] = [];
      if (nFeedbackAppt) det.push(`${nFeedbackAppt} with feedback recorded afterwards`);
      if (nUnconfirmed) det.push(`${nUnconfirmed} without recorded feedback, so ${nUnconfirmed === 1 ? "its" : "their"} outcome cannot be confirmed`);
      if (nUpcoming) det.push(`${nUpcoming} still upcoming at the time of generation`);
      if (det.length) s += ` (${list(det)})`;
      parts.push(s + ".");
    } else parts.push("No appointments were scheduled during the period.");
    if (feedback.length) {
      const nClients = new Set(feedback.map((f) => f.client_id)).size;
      parts.push(`${plural(feedback.length, "feedback entry was", "feedback entries were")} recorded from ${plural(nClients, "client")}${potentialFeedback.length ? `, including ${plural(potentialFeedback.length, "entry", "entries")} from potential clients` : ""}.`);
    } else parts.push("No client feedback was recorded during the period.");
    const tone: string[] = [];
    if (cls.positive.length) tone.push("positive responses");
    if (cls.concern.length) tone.push("concerns or reservations");
    if (cls.objection.length) tone.push("objections");
    if (tone.length) parts.push(`The recorded feedback contains ${list(tone)}, detailed below.`);
    if (pains.length) parts.push(`The most frequently documented challenge area was ${pains.slice().sort((a, b) => b.hits.length - a.hits.length)[0].name.toLowerCase()}.`);
    if (missed.length) parts.push(`${plural(missed.length, "follow-up is", "follow-ups are")} overdue and ${missed.length === 1 ? "requires" : "require"} attention.`);
    p(parts.join(" "));
  }

  // 2 ------------------------------------------------------------------
  h("2. Appointment Summary");
  if (!appointments.length) p("No appointments were scheduled within this reporting period.");
  for (const { c, s } of statuses) {
    out.push("");
    p(`${label(c)} — ${longDate(c.appointment_date!)}, ${time12(c.appointment_time)}`);
    if (c.course) b(`Course: ${c.course}`);
    if (c.partner) b(`Consultant: ${c.partner}`);
    b(`Status: ${s === "upcoming" ? "Scheduled; upcoming at the time of this report." :
      s === "feedback" ? "Feedback was recorded after the scheduled time (see Client Feedback)." :
      "Scheduled. No feedback has been recorded, so it is not confirmed whether the meeting took place."}`);
    const rem = sentenceSplit(c.remarks);
    if (rem.length) b(`Recorded remarks: ${rem.slice(0, 6).map(quote).join(" ")}${rem.length > 6 ? " (further remarks in the client record)" : ""}`);
    else b("No remarks were recorded for this appointment.");
  }

  // 3 ------------------------------------------------------------------
  h("3. Client Feedback");
  if (!feedback.length) p("No client feedback was recorded during this period.");
  else {
    const section = (title: string, items: Cls[], empty?: string) => {
      if (!items.length) { if (empty) { out.push(""); p(`${title}: ${empty}`); } return; }
      out.push(""); p(`${title}:`);
      items.forEach((x) => b(`${label(x.c)}${x.c.schedule_type === "potential" ? " [potential client]" : ""}: ${quote(x.s)}`));
    };
    section("Positive responses", cls.positive, "none explicitly recorded.");
    section("Concerns and reservations", cls.concern, "none explicitly recorded.");
    section("Objections", cls.objection, "none explicitly recorded.");
    section("Suggestions and requests", cls.suggestion);
    section("Changes in client requirements", cls.change);
    section("Follow-up discussions", cls.followup);
    out.push(""); p("All feedback entries for the period:");
    feedback.forEach((f) => {
      const c = fbClient(f);
      b(`${shortDate(sgtDate(new Date(f.created_at)))} — ${label(c)}${c.schedule_type === "potential" ? " [potential client]" : ""}: ${quote(f.content.replace(/\s+/g, " ").trim())}`);
    });
  }

  // 4 ------------------------------------------------------------------
  h("4. Training Interests and Opportunities");
  if (!courseMap.size && !trainingMentions.length && !confirmedSentences.length) {
    p("No specific courses or training requirements were documented for the clients engaged this period.");
  } else {
    if (courseMap.size) {
      p("Courses recorded against clients engaged this period (recorded interest, not confirmed enrolment unless stated below):");
      for (const [course, cs] of courseMap) b(`${course}: ${list(cs.map(label))}`);
    }
    if (confirmedSentences.length) {
      out.push(""); p("Statements in feedback indicating confirmation or commitment:");
      confirmedSentences.forEach((x) => b(`${label(x.c)}: ${quote(x.s)}`));
    }
    if (trainingMentions.length) {
      out.push(""); p("Documented training requirements and possible upskilling opportunities:");
      trainingMentions.slice(0, 12).forEach((x) => b(`${label(x.c)} (${x.where}): ${quote(x.s)}`));
    }
    const noCourse = [...engaged.values()].filter((c) => !c.course.trim());
    if (noCourse.length) { out.push(""); p(`No course has been recorded yet for ${list(noCourse.map(label))}; further consultation may help identify suitable training.`); }
  }

  // 5 ------------------------------------------------------------------
  h("5. Challenges and Pain Points");
  if (!pains.length) p("No specific operational challenges or pain points were documented in this period's appointment remarks or feedback.");
  for (const pp of pains) {
    out.push(""); p(`${pp.name}:`);
    pp.hits.slice(0, 6).forEach((x) => b(`${label(x.c)} (${x.where}): ${quote(x.s)}`));
  }

  // 6 ------------------------------------------------------------------
  h("6. Recommended Follow-Up Actions");
  p("The following are recommendations based on the records; they have not yet been carried out unless stated.");
  const recs: string[] = [];
  missed.forEach((t) => { const c = byId.get(t.client_id); recs.push(`Overdue${t.priority === "urgent" ? " (urgent)" : ""}: ${t.title} — was due ${sgtDateTime(t.due_at)}.${c ? "" : ""}`); });
  pending.forEach((t) => recs.push(`Pending${t.priority === "urgent" ? " (urgent)" : ""}: ${t.title} — due ${sgtDateTime(t.due_at)}.`));
  const concernClients = new Map<string, ReportClient>();
  [...cls.concern, ...cls.objection].forEach((x) => concernClients.set(x.c.id, x.c));
  concernClients.forEach((c) => recs.push(`Review and address the concerns or objections raised by ${label(c)} before the next contact.`));
  const followClients = new Map<string, ReportClient>();
  cls.followup.forEach((x) => followClients.set(x.c.id, x.c));
  followClients.forEach((c) => { if (!concernClients.has(c.id)) recs.push(`Act on the follow-up discussed with ${label(c)} (see feedback above).`); });
  statuses.filter((x) => x.s === "unconfirmed").forEach(({ c }) =>
    recs.push(`Confirm whether the appointment with ${label(c)} on ${shortDate(c.appointment_date)} took place and record feedback.`));
  statuses.filter((x) => x.s === "upcoming").forEach(({ c }) =>
    recs.push(`Prepare for the upcoming appointment with ${label(c)} on ${shortDate(c.appointment_date)}${c.course ? `, including course information on ${c.course}` : ""}.`));
  for (const [course, cs] of courseMap) {
    const unconf = cs.filter((c) => !confirmedSentences.some((x) => x.c.id === c.id) && !statuses.some((s) => s.c.id === c.id && s.s === "upcoming"));
    if (unconf.length) recs.push(`Prepare and share course information on ${course} with ${list(unconf.map(label))} where appropriate.`);
  }
  if (pains.some((x) => x.name === "Training budget concerns")) recs.push("Clarify funding options and pricing for clients who raised budget considerations.");
  if (!recs.length) recs.push("No specific follow-up actions are indicated by the records for this period.");
  recs.forEach(b);
  if (completedThisWeek.length) {
    out.push(""); p(`Completed this period (${completedThisWeek.length}):`);
    completedThisWeek.forEach((t) => b(`${t.title} — completed ${sgtDateTime(t.completed_at)}`));
  }

  // 7 ------------------------------------------------------------------
  h("7. Weekly Conclusion");
  const concl: string[] = [];
  if (!appointments.length && !feedback.length) {
    concl.push("There was no recorded client activity this week.");
  } else {
    concl.push(`Client engagement this week comprised ${plural(appointments.length, "scheduled appointment")} and ${plural(feedback.length, "feedback entry", "feedback entries")}.`);
    if (courseMap.size) concl.push(`Recorded course interest centred on ${list([...courseMap.keys()])}.`);
    if (confirmedSentences.length) concl.push(`${plural(confirmedSentences.length, "statement")} in feedback indicate${confirmedSentences.length === 1 ? "s" : ""} a confirmation or commitment.`);
    else concl.push("No enrolment or commitment was confirmed in the records.");
  }
  const attention: string[] = [];
  if (missed.length) attention.push(`${plural(missed.length, "overdue follow-up")}`);
  if (nUnconfirmed) attention.push(`${plural(nUnconfirmed, "appointment")} without recorded feedback`);
  if (concernClients.size) attention.push(`concerns raised by ${plural(concernClients.size, "client")}`);
  if (attention.length) concl.push(`Areas requiring attention: ${list(attention)}.`);
  const nextPriorities: string[] = [];
  if (missed.length || pending.length) nextPriorities.push("clearing outstanding follow-ups");
  if (concernClients.size) nextPriorities.push("addressing recorded concerns");
  if (nUpcoming) nextPriorities.push("preparing for upcoming appointments");
  if (courseMap.size) nextPriorities.push("sharing relevant course information");
  if (nextPriorities.length) concl.push(`Suggested priorities for the following week: ${list(nextPriorities)}.`);
  p(concl.join(" "));

  return out.join("\n").trim() + "\n";
}
