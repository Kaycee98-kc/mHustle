import { useMemo, useState, type FormEvent } from 'react'
import { Flag, ListTodo, Pencil, Trash2 } from 'lucide-react'
import { AutoTextarea, Empty, Field, Segmented, useToast } from '../components/ui'
import PartnerPicker, { splitNames } from '../components/PartnerPicker'
import { TIME_RE, hhmm, newId, useDraft } from '../lib/hooks'
import { useData } from '../lib/store'
import { friendlyError, supabase } from '../lib/supabase'
import { personName, sgtDateTime, shortDate, time12 } from '../lib/format'
import type { HustleTask } from '../lib/types'

type Kind = 'goal' | 'task'
interface Form { draftId: string; kind: Kind; remarks: string; partner: string; date: string; dateTo: string; time: string; timeTo: string }
const blank = (kind: Kind = 'task'): Form => ({ draftId: newId(), kind, remarks: '', partner: '', date: '', dateTo: '', time: '', timeTo: '' })

type TypeFilter = 'all' | Kind
type Status = 'open' | 'done' | 'all'

/** "1 Dec 2026 → 31 Dec 2026", "2 Dec 2026, 10:00 AM – 11:30 AM" */
function whenLine(t: HustleTask): string {
  if (!t.date) return 'No date'
  const to = t.date_to && t.date_to !== t.date ? t.date_to : null
  const from = `${shortDate(t.date)}${t.time ? `, ${time12(t.time)}` : ''}`
  if (to) return `${from} → ${shortDate(to)}${t.time_to ? `, ${time12(t.time_to)}` : ''}`
  return `${from}${t.time_to ? ` – ${time12(t.time_to)}` : ''}`
}

export default function HustleTasks() {
  const { hustle, refresh, partners } = useData()
  const toast = useToast()
  const [draft, setDraft, clearDraft] = useDraft<Form>('mh-draft-hustle-v2', blank())
  const [editing, setEditing] = useState<HustleTask | null>(null)
  const [editForm, setEditForm] = useState<Form | null>(null)
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({})
  const [saving, setSaving] = useState(false)
  // filters
  const [typeF, setTypeF] = useState<TypeFilter>('all')
  const [byF, setByF] = useState('all')
  const [consF, setConsF] = useState('all')
  const [statusF, setStatusF] = useState<Status>('open')

  const f = editForm ?? draft
  const set = (k: keyof Form, v: string) => {
    if (editForm) setEditForm({ ...editForm, [k]: v }); else setDraft((d) => ({ ...d, [k]: v }))
    setErrors((e) => ({ ...e, [k]: undefined }))
  }
  const kindLabel = f.kind === 'goal' ? 'Goal' : 'Task'

  // ---------------------------------------------------------------- filters
  const people = useMemo(() => [...new Set(hustle.map((t) => t.created_by_email || ''))]
    .sort((a, b) => personName(a).localeCompare(personName(b))), [hustle])
  const consultants = useMemo(() => [...new Set([...partners.map((p) => p.name), ...hustle.flatMap((t) => splitNames(t.partner ?? ''))])]
    .sort((a, b) => a.localeCompare(b)), [partners, hustle])

  const base = useMemo(() => hustle.filter((t) =>
    (byF === 'all' || (t.created_by_email || '') === byF) &&
    (consF === 'all' || (consF === '__none' ? !splitNames(t.partner ?? '').length : splitNames(t.partner ?? '').includes(consF))) &&
    (statusF === 'all' || (statusF === 'done' ? !!t.completed : !t.completed))), [hustle, byF, consF, statusF])
  const count = (k: TypeFilter) => (k === 'all' ? base.length : base.filter((t) => (t.kind ?? 'task') === k).length)

  const shown = useMemo(() => base
    .filter((t) => typeF === 'all' || (t.kind ?? 'task') === typeF)
    .sort((a, b) =>
      Number(!!a.completed) - Number(!!b.completed) ||
      (a.completed ? (b.completed_at ?? '').localeCompare(a.completed_at ?? '')
        : `${a.date ?? '9999'}${a.time ?? ''}`.localeCompare(`${b.date ?? '9999'}${b.time ?? ''}`))), [base, typeF])

  // ---------------------------------------------------------------- actions
  async function submit(ev: FormEvent) {
    ev.preventDefault()
    if (saving) return
    const e: typeof errors = {}
    if (!f.remarks.trim()) e.remarks = 'Remarks are required.'
    if (f.dateTo && !f.date) e.date = 'Please choose Date From.'
    if (f.date && f.dateTo && f.dateTo < f.date) e.dateTo = 'Date To cannot be earlier than Date From.'
    if (f.time && !TIME_RE.test(f.time)) e.time = 'Please enter a valid time.'
    if (f.timeTo && !TIME_RE.test(f.timeTo)) e.timeTo = 'Please enter a valid time.'
    if ((f.time || f.timeTo) && !f.date) e.date = 'Please choose a date for this time.'
    if (f.time && f.timeTo && (!f.dateTo || f.dateTo === f.date) && f.timeTo < f.time) e.timeTo = 'Time To cannot be earlier than Time From.'
    setErrors(e)
    if (Object.keys(e).length) return
    setSaving(true)
    const row = {
      kind: f.kind, remarks: f.remarks, partner: f.partner,
      date: f.date || null, date_to: f.dateTo || null, time: f.time || null, time_to: f.timeTo || null,
    }
    try {
      if (editing) {
        const { error } = await supabase.from('hustle_tasks').update(row).eq('id', editing.id)
        if (error) throw error
        toast('ok', `${kindLabel} updated.`)
        setEditing(null); setEditForm(null)
      } else {
        const { error } = await supabase.from('hustle_tasks').insert({ id: f.draftId, ...row })
        if (error && error.code !== '23505') throw error
        toast('ok', `${kindLabel} saved.`)
        clearDraft(); setDraft(blank(f.kind))
      }
      await refresh()
    } catch (err) {
      const msg = friendlyError(err)
      toast('error', /kind|date_to|time_to|created_by_email|partner/.test(msg) ? 'Run database update 10 first.' : msg)
    } finally { setSaving(false) }
  }

  async function toggleDone(t: HustleTask) {
    try {
      const { error } = await supabase.from('hustle_tasks').update({ completed: !t.completed }).eq('id', t.id)
      if (error) throw error
      toast('ok', t.completed ? 'Reopened — reminders restored.' : 'Completed — reminders stopped.')
      await refresh()
    } catch (err) { toast('error', friendlyError(err)) }
  }

  async function remove(t: HustleTask) {
    const first = t.remarks.trim().split('\n')[0].slice(0, 60)
    if (!window.confirm(`Delete this ${t.kind === 'goal' ? 'goal' : 'task'}?\n\n"${first}"\n\nThis cannot be undone.`)) return
    try {
      const { error } = await supabase.from('hustle_tasks').delete().eq('id', t.id)
      if (error) throw error
      if (editing?.id === t.id) { setEditing(null); setEditForm(null) }
      toast('ok', 'Deleted.')
      await refresh()
    } catch (err) { toast('error', friendlyError(err)) }
  }

  function startEdit(t: HustleTask) {
    setEditing(t)
    setEditForm({
      draftId: t.id, kind: (t.kind ?? 'task') as Kind, remarks: t.remarks, partner: t.partner ?? '',
      date: t.date ?? '', dateTo: t.date_to ?? '', time: hhmm(t.time), timeTo: hhmm(t.time_to),
    })
    setErrors({})
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ---------------------------------------------------------------- view
  return (
    <div className="stack">
      <form className="card form" onSubmit={submit} noValidate>
        {editing && <div className="edit-banner">Editing {editing.kind === 'goal' ? 'goal' : 'task'}</div>}

        <fieldset className="schedule">
          <legend>Type</legend>
          <div className="type-buttons cols-2" role="radiogroup" aria-label="Goal or Task">
            {([['goal', 'Goal', Flag], ['task', 'Task', ListTodo]] as const).map(([v, l, Icon]) => (
              <button key={v} type="button" role="radio" aria-checked={f.kind === v} className={f.kind === v ? 'active' : ''}
                onClick={() => set('kind', v)}><Icon size={18} aria-hidden /> {l}</button>
            ))}
          </div>
        </fieldset>

        <Field label="Remarks" htmlFor="ht-remarks" required error={errors.remarks}>
          <AutoTextarea id="ht-remarks" value={f.remarks} onChange={(e) => set('remarks', e.target.value)}
            placeholder={f.kind === 'goal' ? 'The goal, target or result you are working towards…' : 'Preparation, deadlines, responsibilities…'} />
        </Field>

        <Field label="Consultant" htmlFor="ht-consultant">
          <PartnerPicker id="ht-consultant" value={f.partner} onChange={(v) => set('partner', v)} />
        </Field>

        <div className="pair">
          <Field label="Date From" htmlFor="ht-date" error={errors.date}>
            <input id="ht-date" type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label="Date To" htmlFor="ht-date-to" error={errors.dateTo}>
            <input id="ht-date-to" type="date" min={f.date || undefined} value={f.dateTo} onChange={(e) => set('dateTo', e.target.value)} />
          </Field>
        </div>
        <div className="pair">
          <Field label="Time From (optional)" htmlFor="ht-time" error={errors.time}>
            <input id="ht-time" type="time" value={f.time} onChange={(e) => set('time', e.target.value)} />
          </Field>
          <Field label="Time To (optional)" htmlFor="ht-time-to" error={errors.timeTo}>
            <input id="ht-time-to" type="time" value={f.timeTo} onChange={(e) => set('timeTo', e.target.value)} />
          </Field>
        </div>
        <p className="hint">
          Apple Reminders list: <strong>Hustle Task</strong> — alerts 7 days, 2 days, 1 day and 2 hours before Date From
          {f.date && !f.time ? ' (9:00 AM used when no time is set)' : ''}. Recorded by you.
        </p>

        <div className="form-actions">
          {editing && <button type="button" className="btn btn-ghost" onClick={() => { setEditing(null); setEditForm(null); setErrors({}) }} disabled={saving}>Cancel Edit</button>}
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save Changes' : `Submit ${kindLabel}`}</button>
        </div>
      </form>

      <h3>Saved Goals &amp; Tasks</h3>
      <div className="list-controls cols-3">
        <label className="control">
          <span>By who</span>
          <select value={byF} onChange={(e) => setByF(e.target.value)} aria-label="Filter by who recorded it">
            <option value="all">Everyone</option>
            {people.map((p) => <option key={p} value={p}>{p ? personName(p) : 'Unknown'}</option>)}
          </select>
        </label>
        <label className="control">
          <span>Consultant</span>
          <select value={consF} onChange={(e) => setConsF(e.target.value)} aria-label="Filter by consultant">
            <option value="all">All consultants</option>
            {consultants.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value="__none">No consultant</option>
          </select>
        </label>
        <label className="control">
          <span>Status</span>
          <select value={statusF} onChange={(e) => setStatusF(e.target.value as Status)} aria-label="Filter by status">
            <option value="open">Open</option>
            <option value="done">Completed</option>
            <option value="all">All</option>
          </select>
        </label>
      </div>
      <Segmented<TypeFilter> label="Goals or Tasks" value={typeF} onChange={setTypeF} options={[
        { value: 'all', label: 'All', count: count('all') },
        { value: 'goal', label: 'Goals', count: count('goal') },
        { value: 'task', label: 'Tasks', count: count('task') },
      ]} />

      {!shown.length && <Empty>{hustle.length ? 'Nothing matches these filters.' : 'No goals or tasks yet.'}</Empty>}
      {shown.map((t) => (
        <article key={t.id} className={`card fb-card ht-card${editing?.id === t.id ? ' is-editing' : ''}${t.completed ? ' is-done' : ''}`}>
          <div className="fb-top">
            <label className="check ht-check">
              <input type="checkbox" checked={!!t.completed} onChange={() => toggleDone(t)} aria-label={t.completed ? 'Mark as not done' : 'Mark as done'} />
              <span className="ht-head">
                <span className={`badge ${t.kind === 'goal' ? 'badge-goal' : 'badge-task'}`}>{t.kind === 'goal' ? 'Goal' : 'Task'}</span>
                <span className="task-when">{whenLine(t)}</span>
              </span>
            </label>
            <span className="row-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => startEdit(t)}><Pencil size={14} aria-hidden /> Edit</button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(t)} aria-label="Delete"><Trash2 size={14} aria-hidden /></button>
            </span>
          </div>
          <div className="pre ht-remarks">{t.remarks}</div>
          <div className="ht-meta">
            {t.partner ? <span>Consultant: <strong>{t.partner}</strong></span> : <span className="muted">No consultant</span>}
            <span className="muted">by {personName(t.created_by_email)}</span>
            {t.completed && t.completed_at && <span className="muted">Completed {sgtDateTime(t.completed_at)}</span>}
          </div>
        </article>
      ))}
    </div>
  )
}
