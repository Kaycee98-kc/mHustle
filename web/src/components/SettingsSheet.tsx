import { useEffect, useState } from 'react'
import { Bell, BellOff, CalendarPlus, Copy, KeyRound, LogOut, Plus, Trash2, X } from 'lucide-react'
import { Field, useToast } from './ui'
import { useData } from '../lib/store'
import { friendlyError, supabase } from '../lib/supabase'
import { currentSubscription, disablePush, enablePush, pushSupport } from '../lib/push'
import { hhmm } from '../lib/hooks'
import { getThemeChoice, setThemeChoice, type ThemeChoice } from '../lib/theme'

export default function SettingsSheet({ onClose, email }: { onClose: () => void; email: string }) {
  const { settings, refresh, partners } = useData()
  const [np, setNp] = useState({ name: '', role: 'Partner' as 'Partner' | 'Consultant', phone: '', email: '' })
  const toast = useToast()
  const [pushOn, setPushOn] = useState(false)
  const [theme, setTheme] = useState<ThemeChoice>(getThemeChoice())
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [form, setForm] = useState({
    urgent_repeat_minutes: settings?.urgent_repeat_minutes ?? 240,
    email_repeat_minutes: settings?.email_repeat_minutes ?? 240,
    feedback_due_hours: settings?.feedback_due_hours ?? 24,
    initial_email_due_hours: settings?.initial_email_due_hours ?? 24,
    monday_reminder_time: hhmm(settings?.monday_reminder_time) || '09:00',
    quiet_start: hhmm(settings?.quiet_start) || '22:00',
    quiet_end: hhmm(settings?.quiet_end) || '08:00',
  })
  const support = pushSupport()
  const syncUrl = `${window.location.origin}/api/reminders-sync`
  const httpsCalUrl = (t: string) => `${window.location.origin}/api/calendar?t=${t}`
  const webcalUrl = (t: string) => `webcal://${window.location.host}/api/calendar?t=${t}`

  useEffect(() => { void currentSubscription().then((s) => setPushOn(Boolean(s))) }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function togglePush() {
    setBusy(true)
    try {
      if (pushOn) { await disablePush(); setPushOn(false); toast('ok', 'Notifications turned off on this device.') }
      else { await enablePush(); setPushOn(true); toast('ok', 'Notifications enabled on this device.') }
    } catch (e) { toast('error', friendlyError(e)) } finally { setBusy(false) }
  }

  async function saveSettings() {
    setBusy(true)
    try {
      const { error } = await supabase.from('settings').update(form).eq('owner_id', settings?.owner_id ?? '')
      if (error) throw error
      toast('ok', 'Settings saved.')
      await refresh()
    } catch (e) { toast('error', friendlyError(e)) } finally { setBusy(false) }
  }

  async function addPartner() {
    const name = np.name.trim().replace(/,/g, ' ')
    if (!name) { toast('error', 'Please enter a name.'); return }
    const { error } = await supabase.from('partners').insert({ name, role: np.role, phone: np.phone.trim(), email: np.email.trim() })
    if (error) { toast('error', error.code === '23505' ? `${name} is already in your list.` : /relation .*partners/i.test(error.message) ? 'Run database update 0004 first.' : friendlyError(error)); return }
    setNp({ name: '', role: np.role, phone: '', email: '' })
    toast('ok', `${name} added.`)
    await refresh()
  }

  async function removePartner(id: string, name: string) {
    if (!window.confirm(`Remove ${name} from your list?\n\nClients that already list ${name} keep the name.`)) return
    const { error } = await supabase.from('partners').delete().eq('id', id)
    if (error) { toast('error', friendlyError(error)); return }
    await refresh()
  }

  async function newToken() {
    if (settings?.sync_token_hash && !window.confirm('Create a new link? Your current Calendar subscription and Shortcut will stop working until you set them up with the new one.')) return
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const t = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
    const { error } = await supabase.rpc('mh_set_sync_token', { p_token: t })
    if (error) { toast('error', friendlyError(error)); return }
    setToken(t)
    await refresh()
  }

  const copy = async (s: string) => { try { await navigator.clipboard.writeText(s); toast('ok', 'Copied.') } catch { toast('error', 'Copy failed — select and copy manually.') } }
  const num = (k: keyof typeof form, label: string, min: number) => (
    <Field label={label} htmlFor={`st-${k}`}>
      <input id={`st-${k}`} type="number" min={min} value={form[k]} onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })} />
    </Field>
  )
  const time = (k: keyof typeof form, label: string) => (
    <Field label={label} htmlFor={`st-${k}`}>
      <input id={`st-${k}`} type="time" value={form[k] as string} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
    </Field>
  )

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Settings</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close settings"><X size={20} /></button>
        </div>

        <section>
          <h3>Appearance</h3>
          <div className="type-buttons" role="radiogroup" aria-label="Theme" style={{ width: '100%' }}>
            {([['dark', 'Dark'], ['light', 'Light'], ['system', 'Match device']] as const).map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={theme === v} className={theme === v ? 'active' : ''}
                onClick={() => { setTheme(v); setThemeChoice(v) }}>{l}</button>
            ))}
          </div>
          <p className="hint">Saved on this device only.</p>
        </section>

        <section>
          <h3>Notifications on this device</h3>
          {support.ok ? (
            <button type="button" className={`btn ${pushOn ? 'btn-ghost' : 'btn-primary'}`} onClick={togglePush} disabled={busy}>
              {pushOn ? <><BellOff size={16} /> Turn off notifications</> : <><Bell size={16} /> Enable notifications</>}
            </button>
          ) : <p className="hint">{support.reason}</p>}
        </section>

        <section>
          <h3>Follow-up reminder rules</h3>
          <div className="pair">
            {num('urgent_repeat_minutes', 'Urgent repeat (minutes)', 15)}
            {num('email_repeat_minutes', 'Initial-email repeat (minutes)', 15)}
          </div>
          <div className="pair">
            {num('feedback_due_hours', 'Urgent follow-up due after (hours)', 1)}
            {num('initial_email_due_hours', 'Initial email due after (hours)', 1)}
          </div>
          <div className="pair">
            {time('monday_reminder_time', 'Next-Monday reminder time')}
            <div />
          </div>
          <div className="pair">
            {time('quiet_start', 'Quiet hours start')}
            {time('quiet_end', 'Quiet hours end')}
          </div>
          <p className="hint">Due-time changes apply to follow-ups created after saving.</p>
          <button type="button" className="btn btn-primary" onClick={saveSettings} disabled={busy}>Save Settings</button>
        </section>

        <section>
          <h3>Partners &amp; Consultants</h3>
          <p className="hint">Colleagues you can tick in the Partner field. mHustle reminds you when an appointment, lesson or follow-up has no one assigned.</p>
          {partners.length > 0 && (
            <ul className="partner-list">
              {partners.map((p) => (
                <li key={p.id}>
                  <span><strong>{p.name}</strong> <span className={`badge ${p.role === 'Partner' ? 'badge-appointment' : 'badge-lesson'}`}>{p.role}</span>
                    {(p.phone || p.email) && <span className="muted small"> · {[p.phone, p.email].filter(Boolean).join(' · ')}</span>}</span>
                  <button type="button" className="icon-btn icon-btn-sm" aria-label={`Remove ${p.name}`} onClick={() => removePartner(p.id, p.name)}><Trash2 size={16} /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="pair">
            <Field label="Name" htmlFor="pt-name"><input id="pt-name" type="text" value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} /></Field>
            <Field label="Role" htmlFor="pt-role">
              <select id="pt-role" value={np.role} onChange={(e) => setNp({ ...np, role: e.target.value as 'Partner' | 'Consultant' })}>
                <option>Partner</option><option>Consultant</option>
              </select>
            </Field>
          </div>
          <div className="pair">
            <Field label="Phone (optional)" htmlFor="pt-phone"><input id="pt-phone" type="tel" value={np.phone} onChange={(e) => setNp({ ...np, phone: e.target.value })} /></Field>
            <Field label="Email (optional)" htmlFor="pt-email"><input id="pt-email" type="email" value={np.email} onChange={(e) => setNp({ ...np, email: e.target.value })} /></Field>
          </div>
          <button type="button" className="btn btn-primary" onClick={addPartner}><Plus size={16} /> Add to list</button>
        </section>

        <section>
          <h3>iPhone Calendar &amp; Apple Reminders</h3>
          <p className="hint">One private link keeps your Calendar up to date automatically (Appointments, Lessons, Hustle Tasks and open Follow Ups, with 7-day, 2-day, 1-day and 2-hour alerts). The same token lets the “mHustle Sync” Shortcut update Apple Reminders.</p>
          {token ? (
            <div className="token-box">
              <p className="hint"><strong>Save these now</strong> — the token is shown only once. Creating a new token disconnects the old links.</p>
              <div className="btn-row">
                <a className="btn btn-primary" href={webcalUrl(token)}><CalendarPlus size={16} /> Add to Calendar</a>
                <button type="button" className="btn btn-ghost" onClick={() => copy(httpsCalUrl(token))}><Copy size={16} /> Copy calendar link</button>
              </div>
              <div className="field"><label>Shortcut address</label>
                <div className="copy-row"><code>{syncUrl}</code><button type="button" className="icon-btn" aria-label="Copy address" onClick={() => copy(syncUrl)}><Copy size={16} /></button></div></div>
              <div className="field"><label>Token</label>
                <div className="copy-row"><code>{token}</code><button type="button" className="icon-btn" aria-label="Copy token" onClick={() => copy(token)}><Copy size={16} /></button></div></div>
              <p className="hint">On iPhone: tap <strong>Add to Calendar</strong> → Subscribe. Then in Settings → Apps → Calendar → Calendar Accounts → mHustle, turn <strong>off “Remove Alerts”</strong>.</p>
            </div>
          ) : (
            <p className="hint">{settings?.sync_token_hash ? 'A link is active. To set up another device, create a new link (the old one stops working).' : 'No link yet.'}</p>
          )}
          <button type="button" className={`btn ${settings?.sync_token_hash ? 'btn-ghost' : 'btn-primary'}`} onClick={newToken}>
            <KeyRound size={16} /> {settings?.sync_token_hash ? 'Create new calendar & sync link' : 'Create calendar & sync link'}
          </button>
        </section>

        <section>
          <h3>Account &amp; sharing</h3>
          <p className="hint">Signed in as {email}</p>
          <p className="hint">mHustle is shared: everyone with a login sees and edits the same clients, feedback, follow-ups, Hustle Tasks, partners and reports. Notifications and the calendar/sync link are personal to each person. To give a colleague access, create their login in Supabase → Authentication → Users → Add user.</p>
          <button type="button" className="btn btn-ghost" onClick={() => supabase.auth.signOut()}><LogOut size={16} /> Sign out</button>
        </section>
      </div>
    </div>
  )
}
