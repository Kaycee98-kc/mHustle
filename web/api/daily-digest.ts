// Daily summary push notification.
//  • Vercel Cron (vercel.json) calls GET /api/daily-digest every day at 00:00 UTC
//    (= about 8 AM Singapore) with "Authorization: Bearer <CRON_SECRET>".
//    A push is sent to everyone who has the daily summary on — only when there
//    are appointments/lessons today or follow-ups needing action.
//  • POST with a signed-in user's token sends that person's own summary now
//    (⚙ Settings → "Send today's summary now").
import webpush from 'web-push'

type Client = {
  name: string; company: string; partner: string; schedule_type: string
  appointment_date: string | null; appointment_time: string | null
  lesson_date_from: string | null; lesson_date_to: string | null; lesson_time_from: string | null
}
type FU = { title: string; due_at: string; priority: string }
type Sub = { id: string; endpoint: string; p256dh: string; auth: string }

const t12 = (t?: string | null) => {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}
export const sgToday = (now = new Date()) => new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10)

/** Builds the summary; returns null when there is nothing to act on today. */
export function buildDigest(today: string, clients: Client[], followups: FU[], now = new Date()) {
  const todays = clients.filter((c) =>
    (c.schedule_type === 'appointment' && c.appointment_date === today) ||
    (c.schedule_type === 'lesson' && !!c.lesson_date_from && c.lesson_date_from <= today &&
      (c.lesson_date_to || c.lesson_date_from) >= today))
  const time = (c: Client) => (c.schedule_type === 'appointment' ? c.appointment_time : c.lesson_time_from) ?? ''
  todays.sort((a, b) => time(a).localeCompare(time(b)))

  const endOfToday = new Date(`${today}T23:59:59+08:00`).getTime()
  const action = followups.filter((f) => new Date(f.due_at).getTime() <= endOfToday || f.priority === 'urgent')
  const overdue = action.filter((f) => new Date(f.due_at).getTime() < now.getTime()).length
  const urgent = action.filter((f) => f.priority === 'urgent').length
  if (!todays.length && !action.length) return null

  const parts: string[] = []
  if (todays.length) {
    const appts = todays.filter((c) => c.schedule_type === 'appointment').length
    const lessons = todays.length - appts
    const what = [appts && `${appts} appointment${appts === 1 ? '' : 's'}`, lessons && `${lessons} lesson${lessons === 1 ? '' : 's'}`].filter(Boolean).join(' & ')
    const list = todays.slice(0, 3).map((c) =>
      `${t12(time(c))} ${c.name}${c.company ? ` (${c.company})` : ''}${c.partner ? ` with ${c.partner}` : ''}`).join('; ')
    parts.push(`${what} today: ${list}${todays.length > 3 ? ` +${todays.length - 3} more` : ''}.`)
  }
  if (action.length) {
    const extra = [overdue && `${overdue} overdue`, urgent && `${urgent} urgent`].filter(Boolean).join(', ')
    parts.push(`${action.length} follow-up${action.length === 1 ? '' : 's'} need action${extra ? ` (${extra})` : ''}.`)
  }
  let body = parts.join(' ')
  if (body.length > 230) body = body.slice(0, 227).trimEnd() + '…'
  const url = todays.length && !action.length ? '/?section=clients' : '/?section=followup'
  return { title: 'mHustle · Today', body, url }
}

function env() {
  return {
    base: (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, ''),
    key: (process.env.VITE_SUPABASE_ANON_KEY || '').trim(),
    pub: (process.env.VITE_VAPID_PUBLIC_KEY || '').trim(),
    priv: (process.env.VAPID_PRIVATE_KEY || '').trim(),
    subject: (process.env.VAPID_SUBJECT || 'https://m-hustle.vercel.app').trim(),
    cron: (process.env.CRON_SECRET || '').trim(),
  }
}

async function send(subs: Sub[], msg: { title: string; body: string; url: string }, drop: (id: string) => Promise<unknown>) {
  const e = env()
  webpush.setVapidDetails(e.subject.startsWith('mailto:') || e.subject.startsWith('https://') ? e.subject : `https://${e.subject}`, e.pub, e.priv)
  const payload = JSON.stringify({ ...msg, tag: 'mh-daily' })
  let sent = 0, removed = 0
  const failures: string[] = []
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600, urgency: 'high' })
      sent++
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) { await drop(s.id); removed++ } else failures.push(String(code ?? (err as Error).message).slice(0, 120))
    }
  }
  return { sent, removed, failures }
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store')
  const e = env()
  if (!e.pub || !e.priv) { res.status(500).json({ error: 'Push is not configured (VAPID keys missing in Vercel).' }); return }
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const anon = { apikey: e.key, 'Content-Type': 'application/json', ...(e.key.startsWith('eyJ') ? { Authorization: `Bearer ${e.key}` } : {}) }

  // ---------------------------------------------------------------- scheduled run
  if (e.cron && bearer === e.cron) {
    const r = await fetch(`${e.base}/rest/v1/rpc/mh_daily_digest`, { method: 'POST', headers: anon, body: JSON.stringify({ p_secret: e.cron }) })
    if (!r.ok) { res.status(502).json({ error: 'Database refused the daily summary (check update 9 was run with the same CRON_SECRET).' }); return }
    const d = await r.json() as { today: string; subs: Sub[]; clients: Client[]; followups: FU[] }
    const msg = buildDigest(d.today, d.clients, d.followups)
    if (!msg) { res.status(200).json({ skipped: 'Nothing due today' }); return }
    if (!d.subs.length) { res.status(200).json({ skipped: 'No devices have notifications on', msg }); return }
    const out = await send(d.subs, msg, (id) => fetch(`${e.base}/rest/v1/rpc/mh_drop_push_subscription`, { method: 'POST', headers: anon, body: JSON.stringify({ p_secret: e.cron, p_id: id }) }))
    res.status(200).json({ ...out, msg })
    return
  }

  // ---------------------------------------------------------------- "send now" for one person
  if (req.method !== 'POST' || !bearer) { res.status(401).json({ error: 'Not authorised' }); return }
  const hdr = { apikey: e.key, Authorization: `Bearer ${bearer}` }
  const me = await fetch(`${e.base}/auth/v1/user`, { headers: hdr })
  if (!me.ok) { res.status(401).json({ error: 'Please sign in again.' }); return }
  const today = sgToday()
  const [cr, fr, sr] = await Promise.all([
    fetch(`${e.base}/rest/v1/clients?select=name,company,partner,schedule_type,appointment_date,appointment_time,lesson_date_from,lesson_date_to,lesson_time_from&or=(appointment_date.eq.${today},lesson_date_from.lte.${today})`, { headers: hdr }),
    fetch(`${e.base}/rest/v1/follow_up_tasks?select=title,due_at,priority&completed=eq.false&cancelled=eq.false`, { headers: hdr }),
    fetch(`${e.base}/rest/v1/push_subscriptions?select=id,endpoint,p256dh,auth`, { headers: hdr }),
  ])
  const subs = (sr.ok ? await sr.json() : []) as Sub[]
  if (!subs.length) { res.status(400).json({ error: 'No device has notifications switched on for your login. Tap “Enable notifications” first.' }); return }
  const msg = buildDigest(today, cr.ok ? await cr.json() : [], fr.ok ? await fr.json() : [])
    ?? { title: 'mHustle · Today', body: 'Nothing due today — no appointments, lessons or follow-ups need action. (On days like this the 8 AM summary is not sent.)', url: '/?section=followup' }
  const out = await send(subs, msg, (id) => fetch(`${e.base}/rest/v1/push_subscriptions?id=eq.${id}`, { method: 'DELETE', headers: hdr }))
  res.status(out.sent ? 200 : 502).json({ ...out, msg })
}
