import { useMemo, useState, type FormEvent } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { AutoTextarea, Empty, Field, useToast } from '../components/ui'
import { TIME_RE, hhmm, newId, useDraft } from '../lib/hooks'
import { useData } from '../lib/store'
import { friendlyError, supabase } from '../lib/supabase'
import { sgtDateTime, shortDate, time12 } from '../lib/format'
import type { HustleTask } from '../lib/types'

interface Form { draftId: string; remarks: string; date: string; time: string }

export default function HustleTasks() {
  const { hustle, refresh } = useData()
  const toast = useToast()
  const [draft, setDraft, clearDraft] = useDraft<Form>('mh-draft-hustle', { draftId: newId(), remarks: '', date: '', time: '' })
  const [editing, setEditing] = useState<HustleTask | null>(null)
  const [editForm, setEditForm] = useState<Form | null>(null)
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({})
  const [saving, setSaving] = useState(false)
  const f = editForm ?? draft
  const set = (k: keyof Form, v: string) => {
    if (editForm) setEditForm({ ...editForm, [k]: v }); else setDraft((d) => ({ ...d, [k]: v }))
    setErrors((e) => ({ ...e, [k]: undefined }))
  }

  const sorted = useMemo(() => [...hustle].sort((a, b) =>
    Number(!!a.completed) - Number(!!b.completed) ||
    (a.completed ? (b.completed_at ?? '').localeCompare(a.completed_at ?? '')
      : `${a.date ?? '9999'}${a.time ?? ''}`.localeCompare(`${b.date ?? '9999'}${b.time ?? ''}`))), [hustle])
  const openCount = hustle.filter((t) => !t.completed).length

  async function toggleDone(t: HustleTask) {
    try {
      const { error } = await supabase.from('hustle_tasks').update({ completed: !t.completed }).eq('id', t.id)
      if (error) throw error
      toast('ok', t.completed ? 'Task reopened — reminders restored.' : 'Task completed — reminders stopped.')
      await refresh()
    } catch (err) { toast('error', friendlyError(err)) }
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    if (saving) return
    const e: typeof errors = {}
    if (!f.remarks.trim()) e.remarks = 'Remarks are required.'
    if (f.time && !TIME_RE.test(f.time)) e.time = 'Please enter a valid time.'
    if (f.time && !f.date) e.date = 'Please choose a date for this time.'
    setErrors(e)
    if (Object.keys(e).length) return
    setSaving(true)
    const row = { remarks: f.remarks, date: f.date || null, time: f.time || null }
    try {
      if (editing) {
        const { error } = await supabase.from('hustle_tasks').update(row).eq('id', editing.id)
        if (error) throw error
        toast('ok', 'Task updated.')
        setEditing(null); setEditForm(null)
      } else {
        const { error } = await supabase.from('hustle_tasks').insert({ id: f.draftId, ...row })
        if (error && error.code !== '23505') throw error
        toast('ok', 'Task saved.')
        clearDraft(); setDraft({ draftId: newId(), remarks: '', date: '', time: '' })
      }
      await refresh()
    } catch (err) { toast('error', friendlyError(err)) } finally { setSaving(false) }
  }

  async function remove(t: HustleTask) {
    const first = t.remarks.trim().split('\n')[0].slice(0, 60)
    if (!window.confirm(`Delete this task?\n\n"${first}"\n\nThis cannot be undone.`)) return
    try {
      const { error } = await supabase.from('hustle_tasks').delete().eq('id', t.id)
      if (error) throw error
      if (editing?.id === t.id) { setEditing(null); setEditForm(null) }
      toast('ok', 'Task deleted.')
      await refresh()
    } catch (err) { toast('error', friendlyError(err)) }
  }

  function startEdit(t: HustleTask) {
    setEditing(t)
    setEditForm({ draftId: t.id, remarks: t.remarks, date: t.date ?? '', time: hhmm(t.time) })
    setErrors({})
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="stack">
      <form className="card form" onSubmit={submit} noValidate>
        {editing && <div className="edit-banner">Editing task</div>}
        <Field label="Remarks" htmlFor="ht-remarks" required error={errors.remarks}>
          <AutoTextarea id="ht-remarks" value={f.remarks} onChange={(e) => set('remarks', e.target.value)}
            placeholder="Preparation, deadlines, responsibilities…" />
        </Field>
        <div className="pair">
          <Field label="Date" htmlFor="ht-date" error={errors.date}>
            <input id="ht-date" type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label="Time" htmlFor="ht-time" error={errors.time}>
            <input id="ht-time" type="time" value={f.time} onChange={(e) => set('time', e.target.value)} />
          </Field>
        </div>
        <p className="hint">Apple Reminders list: <strong>Hustle Task</strong> — alerts 7 days, 2 days, 1 day and 2 hours before{f.date && !f.time ? ' (9:00 AM used when no time is set)' : ''}.</p>
        <div className="form-actions">
          {editing && <button type="button" className="btn btn-ghost" onClick={() => { setEditing(null); setEditForm(null); setErrors({}) }} disabled={saving}>Cancel Edit</button>}
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save Changes' : 'Submit Task'}</button>
        </div>
      </form>

      <h3>Saved Tasks{hustle.length > 0 && <span className="muted small"> · {openCount} open</span>}</h3>
      {!sorted.length && <Empty>No saved tasks.</Empty>}
      {sorted.map((t) => (
        <article key={t.id} className={`card fb-card ht-card${editing?.id === t.id ? ' is-editing' : ''}${t.completed ? ' is-done' : ''}`}>
          <div className="fb-top">
            <label className="check ht-check">
              <input type="checkbox" checked={!!t.completed} onChange={() => toggleDone(t)} aria-label={t.completed ? 'Mark task as not done' : 'Mark task as done'} />
              <span className="task-when">{t.date ? `${shortDate(t.date)}${t.time ? `, ${time12(t.time)}` : ''}` : 'No date'}</span>
            </label>
            <span className="row-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => startEdit(t)}><Pencil size={14} aria-hidden /> Edit</button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(t)} aria-label="Delete task"><Trash2 size={14} aria-hidden /> Delete</button>
            </span>
          </div>
          <div className="pre ht-remarks">{t.remarks}</div>
          {t.completed && t.completed_at && <div className="muted small">Completed {sgtDateTime(t.completed_at)}</div>}
        </article>
      ))}
    </div>
  )
}
