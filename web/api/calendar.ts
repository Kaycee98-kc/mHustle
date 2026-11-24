// GET /api/calendar?t=<sync token>
// A subscribed calendar (iPhone/Mac Calendar) showing Appointments, Lessons,
// Hustle Tasks and open Follow Ups — with 7-day, 2-day, 1-day and 2-hour alerts.
// Calendar apps re-download it automatically, so changes in mHustle appear on
// their own. Runs on Vercel; uses only the public key plus your private token.

type Client = {
  id: string; name: string; company: string; address: string; contact: string; email: string
  course: string; partner: string; remarks: string; schedule_type: 'appointment' | 'lesson'
  appointment_date: string | null; appointment_time: string | null
  lesson_date_from: string | null; lesson_date_to: string | null
  lesson_time_from: string | null; lesson_time_to: string | null; updated_at: string
}
type HTask = { id: string; remarks: string; date: string; time: string | null; updated_at: string
  kind?: 'goal' | 'task'; date_to?: string | null; time_to?: string | null; partner?: string }
type FU = { id: string; title: string; task_type: string; priority: string; due_at: string; remind_at: string
  description: string; updated_at: string; contact: string; email: string; partner?: string }
export type Feed = { clients: Client[]; tasks: HTask[]; followups: FU[] }

const FOUR_ALERTS = ['-P7D', '-P2D', '-P1D', '-PT2H']

const sgt = (date: string, time?: string | null) => new Date(`${date}T${(time || '09:00').slice(0, 5)}:00+08:00`)
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const dateOnly = (date: string) => date.replace(/-/g, '')
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}
const esc = (s: string) => (s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const t12 = (t?: string | null) => {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

/** Fold content lines at 75 octets (RFC 5545). */
function fold(line: string): string {
  const enc = new TextEncoder()
  if (enc.encode(line).length <= 75) return line
  const out: string[] = []
  let cur = '', bytes = 0, limit = 75
  for (const ch of line) {
    const b = enc.encode(ch).length
    if (bytes + b > limit) { out.push(cur); cur = ''; bytes = 0; limit = 74 }
    cur += ch; bytes += b
  }
  out.push(cur)
  return out.join('\r\n ')
}

function event(o: {
  uid: string; stamp: string; summary: string; description?: string; location?: string
  start: Date | string; end: Date | string; allDay?: boolean; alarms: string[]
}): string[] {
  const L = ['BEGIN:VEVENT', `UID:${o.uid}@mhustle`, `DTSTAMP:${o.stamp}`]
  if (o.allDay) {
    L.push(`DTSTART;VALUE=DATE:${dateOnly(o.start as string)}`, `DTEND;VALUE=DATE:${dateOnly(o.end as string)}`)
  } else {
    L.push(`DTSTART:${utc(o.start as Date)}`, `DTEND:${utc(o.end as Date)}`)
  }
  L.push(`SUMMARY:${esc(o.summary)}`)
  if (o.location) L.push(`LOCATION:${esc(o.location)}`)
  if (o.description) L.push(`DESCRIPTION:${esc(o.description.slice(0, 1500))}`)
  for (const trig of o.alarms) {
    L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(o.summary)}`, `TRIGGER:${trig}`, 'END:VALARM')
  }
  L.push('END:VEVENT')
  return L
}

export function buildIcs(feed: Feed, now = new Date()): string {
  const stamp = utc(now)
  const L: string[] = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//mHustle//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:mHustle', 'X-WR-TIMEZONE:Asia/Singapore',
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M', 'X-PUBLISHED-TTL:PT15M',
  ]
  const withP = (p?: string) => (p && p.trim() ? ` (with ${p.trim()})` : '')
  const label = (c: Client) => (c.company ? `${c.name} — ${c.company}` : c.name)
  const details = (c: Client) => [
    c.course && `Course: ${c.course}`, c.partner && `Partner: ${c.partner}`,
    c.contact && `Contact: ${c.contact}`, c.email && `Email: ${c.email}`, c.remarks && `\n${c.remarks}`,
  ].filter(Boolean).join('\n')

  for (const c of feed.clients ?? []) {
    if (c.schedule_type === 'appointment' && c.appointment_date) {
      const start = sgt(c.appointment_date, c.appointment_time)
      L.push(...event({ uid: `client-${c.id}`, stamp, summary: `Appointment: ${label(c)}${withP(c.partner)}`, location: c.address,
        description: details(c), start, end: new Date(start.getTime() + 3600_000), alarms: FOUR_ALERTS }))
    }
    if (c.schedule_type === 'lesson' && c.lesson_date_from) {
      const last = c.lesson_date_to && c.lesson_date_to >= c.lesson_date_from ? c.lesson_date_to : c.lesson_date_from
      let day = c.lesson_date_from
      for (let i = 0; i < 62 && day <= last; i++, day = addDays(day, 1)) {
        const start = sgt(day, c.lesson_time_from)
        let end = c.lesson_time_to ? sgt(day, c.lesson_time_to) : new Date(start.getTime() + 3600_000)
        if (end <= start) end = new Date(start.getTime() + 3600_000)
        const multi = last !== c.lesson_date_from
        L.push(...event({ uid: `client-${c.id}-${day}`, stamp,
          summary: `Lesson: ${label(c)}${multi ? ` (day ${i + 1})` : ''}${withP(c.partner)}`, location: c.address,
          description: `Lesson ${c.lesson_date_from}${multi ? ` to ${last}` : ''}, ${t12(c.lesson_time_from)}${c.lesson_time_to ? `–${t12(c.lesson_time_to)}` : ''}\n${details(c)}`,
          start, end, alarms: i === 0 ? FOUR_ALERTS : [] }))
      }
    }
  }

  for (const t of feed.tasks ?? []) {
    const kind = t.kind === 'goal' ? 'Goal' : 'Task'
    const title = `${kind}: ${(t.remarks.trim().split('\n')[0] || 'Hustle ' + kind).slice(0, 80)}${withP(t.partner)}`
    const last = t.date_to && t.date_to >= t.date ? t.date_to : t.date
    const desc = [t.partner && `Consultant: ${t.partner}`, t.remarks].filter(Boolean).join('\n\n')
    if (t.time) {
      const start = sgt(t.date, t.time)
      let end = t.time_to ? sgt(last, t.time_to) : (last !== t.date ? sgt(last, t.time) : new Date(start.getTime() + 30 * 60_000))
      if (end <= start) end = new Date(start.getTime() + 30 * 60_000)
      L.push(...event({ uid: `task-${t.id}`, stamp, summary: title, description: desc, start, end, alarms: FOUR_ALERTS }))
    } else {
      // all-day (spanning Date From → Date To): alerts at 9:00 AM — 7 days, 2 days, 1 day before, and 7:00 AM on the day
      L.push(...event({ uid: `task-${t.id}`, stamp, summary: title, description: desc,
        start: t.date, end: addDays(last, 1), allDay: true, alarms: ['-P6DT15H', '-P1DT15H', '-PT15H', 'PT7H'] }))
    }
  }

  for (const f of feed.followups ?? []) {
    const isMonday = f.task_type === 'next_monday'
    const start = isMonday ? new Date(f.remind_at) : new Date(new Date(f.due_at).getTime() - 30 * 60_000)
    const end = isMonday ? new Date(start.getTime() + 30 * 60_000) : new Date(f.due_at)
    L.push(...event({ uid: `fu-${f.id}`, stamp,
      summary: `${f.priority === 'urgent' ? '⚠️ ' : ''}Follow Up: ${f.title}${withP(f.partner)}`,
      description: [f.partner ? `With: ${f.partner}` : 'No consultant assigned yet', f.contact && `Contact: ${f.contact}`, f.email && `Email: ${f.email}`, f.description].filter(Boolean).join('\n'),
      start, end, alarms: ['PT0S'] }))
  }

  L.push('END:VCALENDAR')
  return L.map(fold).join('\r\n') + '\r\n'
}

// ------------------------------------------------------------- handler
function supabase() {
  const base = (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '')
  const key = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
  return { base, key }
}

export default async function handler(req: any, res: any) {
  const token = String(req.query?.t ?? '').trim()
  if (token.length < 32) { res.status(401).send('Missing calendar token'); return }
  const { base, key } = supabase()
  try {
    const r = await fetch(`${base}/rest/v1/rpc/mh_calendar_feed`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json', ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ p_token: token }),
    })
    const text = await r.text()
    if (!r.ok) { res.status(/invalid sync token/i.test(text) ? 401 : 502).send(/invalid sync token/i.test(text) ? 'Invalid calendar token' : 'Database error'); return }
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store, max-age=0')
    res.setHeader('Content-Disposition', 'inline; filename="mhustle.ics"')
    res.status(200).send(buildIcs(JSON.parse(text) as Feed))
  } catch {
    res.status(502).send('Calendar temporarily unavailable')
  }
}
