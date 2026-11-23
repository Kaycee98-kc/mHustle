import { useEffect, useState, type FormEvent } from 'react'
import { CalendarClock, GraduationCap, Sparkles } from 'lucide-react'
import { AutoTextarea, Field, useToast } from '../components/ui'
import PartnerPicker from '../components/PartnerPicker'
import { EMAIL_RE, TIME_RE, hhmm, newId, useDraft } from '../lib/hooks'
import { useData } from '../lib/store'
import { friendlyError, supabase } from '../lib/supabase'
import type { Client, ScheduleType } from '../lib/types'

interface Form {
  draftId: string
  name: string; company: string; address: string; contact: string; email: string
  course: string; partner: string; remarks: string
  schedule_type: ScheduleType
  appointment_date: string; appointment_time: string
  lesson_date_from: string; lesson_date_to: string; lesson_time_from: string; lesson_time_to: string
  emailed: boolean
}

const blank = (): Form => ({
  draftId: newId(), name: '', company: '', address: '', contact: '', email: '', course: '', partner: '', remarks: '',
  schedule_type: 'appointment', appointment_date: '', appointment_time: '',
  lesson_date_from: '', lesson_date_to: '', lesson_time_from: '', lesson_time_to: '', emailed: false,
})

const fromClient = (c: Client): Form => ({
  draftId: c.id, name: c.name, company: c.company, address: c.address, contact: c.contact, email: c.email,
  course: c.course, partner: c.partner, remarks: c.remarks, schedule_type: c.schedule_type,
  appointment_date: c.appointment_date ?? '', appointment_time: hhmm(c.appointment_time),
  lesson_date_from: c.lesson_date_from ?? '', lesson_date_to: c.lesson_date_to ?? '',
  lesson_time_from: hhmm(c.lesson_time_from), lesson_time_to: hhmm(c.lesson_time_to), emailed: c.emailed,
})

function validate(f: Form): Record<string, string> {
  const e: Record<string, string> = {}
  if (!f.name.trim()) e.name = 'Name is required.'
  if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) e.email = 'Please enter a valid email address.'
  if (f.contact.trim() && !/^\+?[\d\s\-()]{6,20}$/.test(f.contact.trim())) e.contact = 'Please enter a valid telephone number.'
  const t = (k: keyof Form) => { const v = f[k] as string; if (v && !TIME_RE.test(v)) e[k] = 'Please enter a valid time.' }
  if (f.schedule_type === 'appointment') {
    if (!f.appointment_date) e.appointment_date = 'Appointment Date is required.'
    if (!f.appointment_time) e.appointment_time = 'Appointment Time is required.'
    t('appointment_time')
  }
  if (f.schedule_type === 'lesson') {
    if (!f.lesson_date_from) e.lesson_date_from = 'Lesson Date From is required.'
    if (!f.lesson_time_from) e.lesson_time_from = 'Lesson Time From is required.'
    if (f.lesson_date_from && f.lesson_date_to && f.lesson_date_to < f.lesson_date_from)
      e.lesson_date_to = 'Lesson Date To cannot be earlier than Lesson Date From.'
    if (f.lesson_time_from && f.lesson_time_to && (!f.lesson_date_to || f.lesson_date_to === f.lesson_date_from)
      && f.lesson_time_to < f.lesson_time_from) e.lesson_time_to = 'Lesson Time To cannot be earlier than Lesson Time From.'
    t('lesson_time_from'); t('lesson_time_to')
  }
  return e
}

function toRow(f: Form) {
  const n = (v: string) => (v ? v : null)
  return {
    name: f.name.trim(), company: f.company.trim(), address: f.address.trim(), contact: f.contact.trim(),
    email: f.email.trim(), course: f.course.trim(), partner: f.partner.trim(), remarks: f.remarks,
    schedule_type: f.schedule_type,
    appointment_date: f.schedule_type === 'appointment' ? n(f.appointment_date) : null,
    appointment_time: f.schedule_type === 'appointment' ? n(f.appointment_time) : null,
    lesson_date_from: f.schedule_type === 'lesson' ? n(f.lesson_date_from) : null,
    lesson_date_to: f.schedule_type === 'lesson' ? n(f.lesson_date_to) : null,
    lesson_time_from: f.schedule_type === 'lesson' ? n(f.lesson_time_from) : null,
    lesson_time_to: f.schedule_type === 'lesson' ? n(f.lesson_time_to) : null,
    emailed: f.schedule_type === 'potential' ? f.emailed : false,
  }
}

const TYPES: { value: ScheduleType; label: string; icon: typeof CalendarClock }[] = [
  { value: 'appointment', label: 'Appointment', icon: CalendarClock },
  { value: 'lesson', label: 'Lesson', icon: GraduationCap },
  { value: 'potential', label: 'Potential', icon: Sparkles },
]

export default function NewClient({ editingId, onEditDone }: { editingId: string | null; onEditDone: (id: string | null) => void }) {
  const { clients, refresh } = useData()
  const toast = useToast()
  const [draft, setDraft, clearDraft] = useDraft<Form>('mh-draft-new-client', blank())
  const [editForm, setEditForm] = useState<Form | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const editing = editingId ? clients.find((c) => c.id === editingId) ?? null : null
  useEffect(() => {
    setEditForm(editing ? fromClient(editing) : null)
    setErrors({})
    // only when switching which client is being edited (or once it has loaded)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, Boolean(editing)])

  const f = editForm ?? draft
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    if (editForm) setEditForm({ ...editForm, [k]: v })
    else setDraft((d) => ({ ...d, [k]: v }))
    if (errors[k as string]) setErrors((e) => { const n = { ...e }; delete n[k as string]; return n })
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    if (saving) return
    const e = validate(f)
    setErrors(e)
    if (Object.keys(e).length) { toast('error', 'Please correct the highlighted fields.'); return }
    if (f.schedule_type !== 'potential' && !f.partner.trim() &&
        !window.confirm(`No partner or consultant is selected for this ${f.schedule_type}.\n\nSave without a partner? (Choose Cancel to pick one.)`)) {
      document.getElementById('nc-partner')?.focus()
      return
    }
    setSaving(true)
    try {
      if (editForm && editing) {
        const { error } = await supabase.from('clients').update(toRow(f)).eq('id', editing.id)
        if (error) throw error
        toast('ok', `Changes saved for ${f.name.trim()}.`)
        await refresh()
        onEditDone(editing.id)
      } else {
        // draftId doubles as the record id → resubmitting the same draft cannot create a duplicate
        const { error } = await supabase.from('clients').insert({ id: f.draftId, ...toRow(f) })
        if (error && error.code !== '23505') throw error
        toast('ok', `${f.name.trim()} saved${f.schedule_type === 'potential' && !f.emailed ? ' — initial-email follow-up created' : ''}.`)
        clearDraft()
        setDraft(blank())
        await refresh()
      }
    } catch (err) {
      toast('error', friendlyError(err))
    } finally {
      setSaving(false)
    }
  }

  const text = (k: keyof Form, label: string, opts: { type?: string; required?: boolean; placeholder?: string; autoComplete?: string; inputMode?: 'tel' | 'email' | 'text' } = {}) => (
    <Field label={label} htmlFor={`nc-${k}`} required={opts.required} error={errors[k]}>
      <input id={`nc-${k}`} type={opts.type ?? 'text'} value={f[k] as string} placeholder={opts.placeholder}
        autoComplete={opts.autoComplete ?? 'off'} inputMode={opts.inputMode}
        onChange={(e) => set(k, e.target.value as never)} />
    </Field>
  )

  return (
    <form className="card form" onSubmit={submit} noValidate>
      {editing && <div className="edit-banner">Editing <strong>{editing.name}</strong></div>}
      {text('name', 'Name', { required: true, autoComplete: 'name' })}
      {text('company', 'Company', { autoComplete: 'organization' })}
      {text('address', 'Address', { autoComplete: 'street-address' })}
      {text('contact', 'Contact', { type: 'tel', inputMode: 'tel', placeholder: '+65 9123 4567', autoComplete: 'tel' })}
      {text('email', 'Email', { type: 'email', inputMode: 'email', autoComplete: 'email' })}
      {text('course', 'Course')}
      <Field label="Partner" htmlFor="nc-partner">
        <PartnerPicker id="nc-partner" value={f.partner} onChange={(v) => set('partner', v)} />
      </Field>
      <Field label="Remarks" htmlFor="nc-remarks">
        <AutoTextarea id="nc-remarks" value={f.remarks} onChange={(e) => set('remarks', e.target.value)}
          placeholder="Discussions, operational challenges, pain points, training requirements, concerns, email talking points…" />
      </Field>

      <fieldset className="schedule">
        <legend>Schedule Type</legend>
        <div className="type-buttons" role="radiogroup" aria-label="Schedule Type">
          {TYPES.map(({ value, label, icon: Icon }) => (
            <button key={value} type="button" role="radio" aria-checked={f.schedule_type === value}
              className={f.schedule_type === value ? 'active' : ''} onClick={() => set('schedule_type', value)}>
              <Icon size={18} aria-hidden /> {label}
            </button>
          ))}
        </div>

        {f.schedule_type === 'appointment' && (
          <div className="pair">
            <Field label="Appointment Date" htmlFor="nc-ad" required error={errors.appointment_date}>
              <input id="nc-ad" type="date" value={f.appointment_date} onChange={(e) => set('appointment_date', e.target.value)} />
            </Field>
            <Field label="Appointment Time" htmlFor="nc-at" required error={errors.appointment_time}>
              <input id="nc-at" type="time" value={f.appointment_time} onChange={(e) => set('appointment_time', e.target.value)} />
            </Field>
          </div>
        )}

        {f.schedule_type === 'lesson' && (
          <>
            <div className="pair">
              <Field label="Lesson Date From" htmlFor="nc-ldf" required error={errors.lesson_date_from}>
                <input id="nc-ldf" type="date" value={f.lesson_date_from} onChange={(e) => set('lesson_date_from', e.target.value)} />
              </Field>
              <Field label="Lesson Date To" htmlFor="nc-ldt" error={errors.lesson_date_to}>
                <input id="nc-ldt" type="date" min={f.lesson_date_from || undefined} value={f.lesson_date_to} onChange={(e) => set('lesson_date_to', e.target.value)} />
              </Field>
            </div>
            <div className="pair">
              <Field label="Lesson Time From" htmlFor="nc-ltf" required error={errors.lesson_time_from}>
                <input id="nc-ltf" type="time" value={f.lesson_time_from} onChange={(e) => set('lesson_time_from', e.target.value)} />
              </Field>
              <Field label="Lesson Time To" htmlFor="nc-ltt" error={errors.lesson_time_to}>
                <input id="nc-ltt" type="time" value={f.lesson_time_to} onChange={(e) => set('lesson_time_to', e.target.value)} />
              </Field>
            </div>
          </>
        )}

        {f.schedule_type === 'potential' && (
          <div className="action-done">
            <div className="action-title">Action Done</div>
            <label className="check">
              <input type="checkbox" checked={f.emailed} onChange={(e) => set('emailed', e.target.checked)} />
              <span>Emailed</span>
            </label>
            <p className="hint">
              {f.emailed
                ? 'A one-time follow-up will be scheduled for the next Monday (Follow Up list).'
                : 'An initial-email follow-up will remind you to email this client as soon as possible.'}
            </p>
          </div>
        )}

        {f.schedule_type !== 'potential' && !f.partner.trim() && (
          <p className="nudge">Who's joining this {f.schedule_type}? Select a partner or consultant above.</p>
        )}
        <p className="hint">
          Apple Reminders list: <strong>{f.schedule_type === 'potential' ? 'Follow Up' : 'Clients'}</strong>
          {f.schedule_type !== 'potential' && ' — alerts 7 days, 2 days, 1 day and 2 hours before'}
        </p>
      </fieldset>

      <div className="form-actions">
        {editing && (
          <button type="button" className="btn btn-ghost" onClick={() => onEditDone(editing.id)} disabled={saving}>Cancel Edit</button>
        )}
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : editing ? 'Save Changes' : 'Submit Client'}
        </button>
      </div>
    </form>
  )
}
