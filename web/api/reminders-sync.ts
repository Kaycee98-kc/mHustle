// Apple Reminders bridge for the "mHustle Sync" Shortcut — runs on Vercel,
// so no Supabase command-line setup is needed.
//
// Auth: header  x-mhustle-token: <token from mHustle ⚙ Settings>
// GET                                        → { count, more, ops:[...], ack }
//     op "add":    delete reminders whose Notes contain `key`, then add a new one
//     op "remove": delete reminders whose Notes contain `key`
// POST { "action":"ack", "ack":"<ack from GET>" }
// POST { "action":"completed", "text":"<notes of completed Follow Up reminders>" }

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

export function alertText(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000) // Singapore wall clock
  const h = d.getUTCHours(), m = d.getUTCMinutes()
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} at ${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const base = (process.env.VITE_SUPABASE_URL || '').trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '')
  const key = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
  const r = await fetch(`${base}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json', ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(args),
  })
  const text = await r.text()
  if (!r.ok) {
    const err = new Error(/invalid sync token/i.test(text) ? 'Invalid sync token' : 'Database error') as Error & { status: number }
    err.status = /invalid sync token/i.test(text) ? 401 : 502
    throw err
  }
  return JSON.parse(text)
}

type Item = { key: string; list: string; title: string; notes: string; alert: string; state: string; rev: number }

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store')
  const token = String(req.headers['x-mhustle-token'] ?? req.query?.t ?? '').trim()
  if (token.length < 32) { res.status(401).json({ error: 'Missing sync token' }); return }
  try {
    if (req.method === 'GET') {
      const data = await rpc('mh_sync_pull', { p_token: token }) as { items: Item[]; more: boolean }
      const ops = data.items.map((r) => r.state === 'active'
        ? { op: 'add', key: r.key, list: r.list, title: r.title, notes: r.notes, alert: r.alert, alert_text: alertText(r.alert) }
        : { op: 'remove', key: r.key, list: r.list })
      const ack = Buffer.from(JSON.stringify(data.items.map((r) => [r.key, r.rev]))).toString('base64')
      res.status(200).json({ count: ops.length, more: data.more, ops, ack })
      return
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})
      if (body.action === 'ack' && typeof body.ack === 'string') {
        let pairs: unknown
        try { pairs = JSON.parse(Buffer.from(body.ack, 'base64').toString('utf8')) } catch { res.status(400).json({ error: 'Bad ack' }); return }
        res.status(200).json({ acknowledged: await rpc('mh_sync_ack', { p_token: token, p_pairs: pairs }) })
        return
      }
      if (body.action === 'completed' && typeof body.text === 'string') {
        const ids = [...new Set([...body.text.matchAll(/mh:fu:([0-9a-f-]{36})/gi)].map((m: RegExpMatchArray) => m[1].toLowerCase()))]
        res.status(200).json({ completed: ids.length ? await rpc('mh_sync_completed', { p_token: token, p_ids: ids }) : 0 })
        return
      }
      res.status(400).json({ error: 'Unknown action' })
      return
    }
    res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    const err = e as Error & { status?: number }
    res.status(err.status ?? 500).json({ error: err.message })
  }
}
