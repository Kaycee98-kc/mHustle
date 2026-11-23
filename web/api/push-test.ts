// POST /api/push-test   (Authorization: Bearer <signed-in user's access token>)
// Sends a trial Web Push notification to the signed-in person's own devices,
// summarising the open follow-ups in the shared workspace.
// Needs Vercel env vars: VAPID_PRIVATE_KEY (secret), VAPID_SUBJECT, and the
// existing VITE_VAPID_PUBLIC_KEY / VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
import webpush from 'web-push'

type Sub = { id: string; endpoint: string; p256dh: string; auth: string }
type Task = { title: string; due_at: string; priority: string }

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return }

  const base = (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '')
  const key = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
  const pub = (process.env.VITE_VAPID_PUBLIC_KEY || '').trim()
  const priv = (process.env.VAPID_PRIVATE_KEY || '').trim()
  const subject = (process.env.VAPID_SUBJECT || 'https://m-hustle.vercel.app').trim()
  if (!pub || !priv) {
    res.status(500).json({ error: 'Push is not configured: add VAPID_PRIVATE_KEY (and VITE_VAPID_PUBLIC_KEY) in Vercel → Settings → Environment Variables, then redeploy.' })
    return
  }

  const jwt = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const hdr = { apikey: key, Authorization: `Bearer ${jwt}` }
  const me = await fetch(`${base}/auth/v1/user`, { headers: hdr })
  if (!jwt || !me.ok) { res.status(401).json({ error: 'Please sign in again.' }); return }

  const subsRes = await fetch(`${base}/rest/v1/push_subscriptions?select=id,endpoint,p256dh,auth`, { headers: hdr })
  const subs = (subsRes.ok ? await subsRes.json() : []) as Sub[]
  if (!subs.length) {
    res.status(400).json({ error: 'No device has notifications switched on for your login. Tap “Enable notifications” first (on iPhone: open mHustle from the Home Screen icon).' })
    return
  }

  const tRes = await fetch(`${base}/rest/v1/follow_up_tasks?select=title,due_at,priority&completed=eq.false&cancelled=eq.false&order=due_at.asc&limit=200`, { headers: hdr })
  const tasks = (tRes.ok ? await tRes.json() : []) as Task[]
  const now = Date.now()
  const overdue = tasks.filter((t) => new Date(t.due_at).getTime() < now).length
  const urgent = tasks.filter((t) => t.priority === 'urgent').length
  const body = tasks.length
    ? `${tasks.length} follow-up${tasks.length === 1 ? '' : 's'} open${overdue ? `, ${overdue} overdue` : ''}${urgent ? `, ${urgent} urgent` : ''}. Next: ${tasks[0].title}`
    : 'No open follow-ups right now. Notifications are working.'

  webpush.setVapidDetails(subject.startsWith('mailto:') || subject.startsWith('https://') ? subject : `https://${subject}`, pub, priv)
  const payload = JSON.stringify({ title: 'mHustle test notification', body, tag: 'mh-test', url: '/?section=followup' })

  let sent = 0, removed = 0
  const failures: string[] = []
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 600, urgency: 'high' })
      sent++
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) {
        await fetch(`${base}/rest/v1/push_subscriptions?id=eq.${s.id}`, { method: 'DELETE', headers: hdr })
        removed++
      } else failures.push(String(code ?? (e as Error).message).slice(0, 120))
    }
  }
  res.status(sent ? 200 : 502).json({ sent, removed, failures, devices: subs.length, body })
}
