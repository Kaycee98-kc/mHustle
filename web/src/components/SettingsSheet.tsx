import { useEffect, useState } from 'react'
import { Bell, BellOff, Copy, KeyRound, LogOut, X } from 'lucide-react'
import { Field, useToast } from './ui'
import { useData } from '../lib/store'
import { friendlyError, functionsUrl, supabase } from '../lib/supabase'
import { currentSubscription, disablePush, enablePush, pushSupport } from '../lib/push'
import { hhmm } from '../lib/hooks'

export default function SettingsSheet({ onClose, email }: { onClose: () => void; email: string }) {
  const { settings, refresh } = useData()
  const toast = useToast()
  const [pushOn, setPushOn] = useState(false)
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

  async function newToken() {
    if (settings?.sync_token_hash && !window.confirm('Create a new sync token? The Shortcut will stop working until you paste the new token into it.')) return
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
          <h3>Apple Reminders sync</h3>
          <p className="hint">The “mHustle Sync” Shortcut uses this address and token to update the <strong>Clients</strong>, <strong>Follow Up</strong> and <strong>Hustle Task</strong> lists.</p>
          <div className="copy-row"><code>{functionsUrl}/reminders-sync</code><button type="button" className="icon-btn" aria-label="Copy address" onClick={() => copy(`${functionsUrl}/reminders-sync`)}><Copy size={16} /></button></div>
          {token && (
            <div className="token-box">
              <p className="hint"><strong>Copy this token now</strong> — it is shown only once.</p>
              <div className="copy-row"><code>{token}</code><button type="button" className="icon-btn" aria-label="Copy token" onClick={() => copy(token)}><Copy size={16} /></button></div>
            </div>
          )}
          <button type="button" className="btn btn-ghost" onClick={newToken}><KeyRound size={16} /> {settings?.sync_token_hash ? 'Replace sync token' : 'Create sync token'}</button>
        </section>

        <section>
          <h3>Account</h3>
          <p className="hint">Signed in as {email}</p>
          <button type="button" className="btn btn-ghost" onClick={() => supabase.auth.signOut()}><LogOut size={16} /> Sign out</button>
        </section>
      </div>
    </div>
  )
}
