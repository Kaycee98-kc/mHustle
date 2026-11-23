import { useMemo, useState } from 'react'
import { ChevronDown, MailCheck, MessageSquarePlus, Pencil, Search, Trash2, X } from 'lucide-react'
import { Empty, Segmented, useToast } from '../components/ui'
import { bucket, useData } from '../lib/store'
import { friendlyError, supabase } from '../lib/supabase'
import { scheduleLine, sgtDateTime, shortDate, time12 } from '../lib/format'
import { SCHEDULE_LABEL, TASK_ACTION, type Client, type ScheduleType } from '../lib/types'

type Filter = 'all' | ScheduleType

export default function AllClients({ expandedId, setExpandedId, onEdit, onAddFeedback, onDeleted }: {
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  onEdit: (id: string) => void
  onAddFeedback: (id: string) => void
  onDeleted: (id: string) => void
}) {
  const { clients, feedback, tasks, now, loading, refresh } = useData()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const fbCount = useMemo(() => {
    const m = new Map<string, number>()
    feedback.forEach((f) => m.set(f.client_id, (m.get(f.client_id) ?? 0) + 1))
    return m
  }, [feedback])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return clients
      .filter((c) => filter === 'all' || c.schedule_type === filter)
      .filter((c) => !needle || [c.name, c.company, c.course, c.partner, c.remarks].some((v) => v.toLowerCase().includes(needle)))
  }, [clients, q, filter])

  const sel = clients.filter((c) => selected.has(c.id))
  const toggleSel = (id: string) => setSelected((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allShownSelected = shown.length > 0 && shown.every((c) => selected.has(c.id))
  const selectAllShown = () => setSelected((p) => { const n = new Set(p); if (allShownSelected) shown.forEach((c) => n.delete(c.id)); else shown.forEach((c) => n.add(c.id)); return n })
  const emailable = sel.filter((c) => c.schedule_type === 'potential' && !c.emailed)

  async function bulkDelete() {
    if (!sel.length) return
    const names = sel.slice(0, 5).map((c) => c.name).join(', ') + (sel.length > 5 ? ` and ${sel.length - 5} more` : '')
    if (!window.confirm(`Delete ${sel.length} client${sel.length === 1 ? '' : 's'}?\n\n${names}\n\nTheir feedback and follow-ups are deleted too. This cannot be undone.`)) return
    setBulkBusy(true)
    try {
      const ids = sel.map((c) => c.id)
      const { error } = await supabase.from('clients').delete().in('id', ids)
      if (error) throw error
      ids.forEach(onDeleted)
      toast('ok', `${ids.length} client${ids.length === 1 ? '' : 's'} deleted.`)
      setSelected(new Set())
      await refresh()
    } catch (e) { toast('error', friendlyError(e)) } finally { setBulkBusy(false) }
  }

  async function bulkEmailed() {
    if (!emailable.length) return
    setBulkBusy(true)
    try {
      const { error } = await supabase.from('clients').update({ emailed: true }).in('id', emailable.map((c) => c.id))
      if (error) throw error
      toast('ok', `${emailable.length} potential client${emailable.length === 1 ? '' : 's'} marked Emailed — next-Monday follow-ups scheduled.`)
      setSelected(new Set())
      await refresh()
    } catch (e) { toast('error', friendlyError(e)) } finally { setBulkBusy(false) }
  }

  const counts = (t: Filter) => (t === 'all' ? clients.length : clients.filter((c) => c.schedule_type === t).length)

  return (
    <div className="stack">
      <div className="search">
        <Search size={18} aria-hidden />
        <input type="search" placeholder="Search clients" value={q}
          onChange={(e) => setQ(e.target.value)} aria-label="Search clients" />
      </div>
      <Segmented<Filter> label="Filter clients" value={filter} onChange={setFilter} options={[
        { value: 'all', label: 'All', count: counts('all') },
        { value: 'appointment', label: 'Appointments', count: counts('appointment') },
        { value: 'lesson', label: 'Lessons', count: counts('lesson') },
        { value: 'potential', label: 'Potential', count: counts('potential') },
      ]} />
      {shown.length > 0 && (
        <div className={`bulk-bar${sel.length ? ' active' : ''}`}>
          <label className="check small">
            <input type="checkbox" checked={allShownSelected} onChange={selectAllShown} aria-label="Select all shown clients" />
            <span>{sel.length ? `${sel.length} selected` : 'Select'}</span>
          </label>
          {sel.length > 0 && (
            <span className="row-actions">
              {emailable.length > 0 && <button type="button" className="btn btn-ghost btn-sm" disabled={bulkBusy} onClick={bulkEmailed}><MailCheck size={14} aria-hidden /> Mark Emailed ({emailable.length})</button>}
              <button type="button" className="btn btn-danger btn-sm" disabled={bulkBusy} onClick={bulkDelete}><Trash2 size={14} aria-hidden /> Delete</button>
              <button type="button" className="icon-btn icon-btn-sm" aria-label="Clear selection" onClick={() => setSelected(new Set())}><X size={16} aria-hidden /></button>
            </span>
          )}
        </div>
      )}
      {loading && !clients.length ? <Empty>Loading…</Empty> : !shown.length ? <Empty>{clients.length ? 'No clients match your search.' : 'No clients yet. Add one under New Client.'}</Empty> : null}
      {shown.map((c) => (
        <ClientCard key={c.id} c={c} open={expandedId === c.id} checked={selected.has(c.id)} onCheck={() => toggleSel(c.id)} feedbackCount={fbCount.get(c.id) ?? 0}
          onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
          onEdit={() => onEdit(c.id)} onAddFeedback={() => onAddFeedback(c.id)} onDeleted={() => onDeleted(c.id)}
          feedback={feedback.filter((f) => f.client_id === c.id)}
          tasks={tasks.filter((t) => t.client_id === c.id)} now={now} />
      ))}
    </div>
  )
}

function ClientCard({ c, open, checked, onCheck, feedbackCount, onToggle, onEdit, onAddFeedback, onDeleted, feedback, tasks, now }: {
  c: Client; open: boolean; checked: boolean; onCheck: () => void; feedbackCount: number; onToggle: () => void; onEdit: () => void; onAddFeedback: () => void; onDeleted: () => void
  feedback: ReturnType<typeof useData>['feedback']; tasks: ReturnType<typeof useData>['tasks']; now: number
}) {
  const { refresh } = useData()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function toggleEmailed(v: boolean) {
    setBusy(true)
    try {
      const { error } = await supabase.from('clients').update({ emailed: v }).eq('id', c.id)
      if (error) throw error
      toast('ok', v ? 'Marked as emailed — next-Monday follow-up scheduled.' : 'Emailed cleared — initial-email follow-up reopened.')
      await refresh()
    } catch (e) { toast('error', friendlyError(e)) } finally { setBusy(false) }
  }

  async function remove() {
    const extra = [feedback.length && `${feedback.length} feedback entr${feedback.length === 1 ? 'y' : 'ies'}`,
      tasks.length && `${tasks.length} follow-up${tasks.length === 1 ? '' : 's'}`].filter(Boolean).join(' and ')
    if (!window.confirm(`Delete ${c.name}${c.company ? ` (${c.company})` : ''}?${extra ? `\n\nThis also deletes ${extra}.` : ''}\n\nThis cannot be undone.`)) return
    setBusy(true)
    try {
      const { error } = await supabase.from('clients').delete().eq('id', c.id)
      if (error) throw error
      toast('ok', `${c.name} deleted.`)
      onDeleted()
      await refresh()
    } catch (e) { toast('error', friendlyError(e)) } finally { setBusy(false) }
  }

  const row = (label: string, value: string, pre = false) => value ? (
    <div className="detail"><dt>{label}</dt><dd className={pre ? 'pre' : ''}>{value}</dd></div>
  ) : null

  return (
    <article className={`card client-card${open ? ' open' : ''}${checked ? ' is-selected' : ''}`}>
      <div className="client-row">
      <label className="client-select" aria-label={`Select ${c.name}`}>
        <input type="checkbox" checked={checked} onChange={onCheck} />
      </label>
      <button type="button" className="client-head" onClick={onToggle} aria-expanded={open}>
        <div className="client-main">
          <div className="client-name">{c.name}</div>
          <div className="client-sub">{[c.company, c.course].filter(Boolean).join(' · ') || '—'}</div>
          <div className="client-meta">
            <span className={`badge badge-${c.schedule_type}`}>{SCHEDULE_LABEL[c.schedule_type]}</span>
            <span className="muted">{scheduleLine(c)}</span>
            {feedbackCount > 0 && <span className="muted">· {feedbackCount} feedback</span>}
          </div>
        </div>
        <ChevronDown className="chev" size={20} aria-hidden />
      </button>
      </div>

      {open && (
        <div className="client-body">
          <dl className="details">
            {row('Name', c.name)}
            {row('Company', c.company)}
            {row('Address', c.address)}
            {c.contact && <div className="detail"><dt>Contact</dt><dd><a href={`tel:${c.contact.replace(/[^\d+]/g, '')}`}>{c.contact}</a></dd></div>}
            {c.email && <div className="detail"><dt>Email</dt><dd><a href={`mailto:${c.email}`}>{c.email}</a></dd></div>}
            {row('Course', c.course)}
            {row('Partner', c.partner)}
            {row('Remarks', c.remarks, true)}
            {row('Schedule Type', SCHEDULE_LABEL[c.schedule_type])}
            {c.schedule_type !== 'potential' && row(c.schedule_type === 'lesson' ? 'Lesson schedule' : 'Appointment', scheduleLine(c))}
            {row('Apple Reminders list', c.schedule_type === 'potential' ? 'Follow Up' : 'Clients')}
          </dl>

          {c.schedule_type !== 'potential' && !c.partner.trim() && (
            <p className="nudge">No partner or consultant yet for this {c.schedule_type}. Use Edit Client to add one.</p>
          )}
          {c.schedule_type === 'potential' && (
            <div className="action-done">
              <div className="action-title">Action Done</div>
              <label className="check">
                <input type="checkbox" checked={c.emailed} disabled={busy} onChange={(e) => toggleEmailed(e.target.checked)} />
                <span>Emailed{c.emailed_at && <span className="muted"> · {sgtDateTime(c.emailed_at)}</span>}</span>
              </label>
            </div>
          )}

          <h4>Follow Up status</h4>
          {tasks.length ? (
            <ul className="mini-list">
              {tasks.map((t) => {
                const b = bucket(t, now)
                return (
                  <li key={t.id}>
                    <span className={`pill pill-${b}`}>{b === 'todo' ? 'To Follow Up' : b === 'miss' ? 'Miss' : 'Completed'}</span>
                    {TASK_ACTION[t.task_type]} — {b === 'done' ? `completed ${sgtDateTime(t.completed_at)}` : `due ${sgtDateTime(t.due_at)}`}
                  </li>
                )
              })}
            </ul>
          ) : <p className="muted small">No follow-ups.</p>}

          <h4>Feedback History</h4>
          {feedback.length ? (
            <ul className="fb-list">
              {feedback.map((f) => (
                <li key={f.id}>
                  <div className="muted small">{sgtDateTime(f.created_at)}{f.updated_at !== f.created_at && ` · edited ${sgtDateTime(f.updated_at)}`}</div>
                  {f.postpone_date && <div className="postpone-badge">Postponed{f.previous_date ? ` from ${shortDate(f.previous_date)}, ${time12(f.previous_time)}` : ''} to {shortDate(f.postpone_date)}, {time12(f.postpone_time)}</div>}
                  {f.content && <div className="pre">{f.content}</div>}
                </li>
              ))}
            </ul>
          ) : <p className="muted small">No feedback recorded.</p>}

          <div className="form-actions">
            <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}><Trash2 size={16} aria-hidden /> Delete</button>
            <button type="button" className="btn btn-ghost" onClick={onEdit}><Pencil size={16} aria-hidden /> Edit Client</button>
            <button type="button" className="btn btn-primary" onClick={onAddFeedback}><MessageSquarePlus size={16} aria-hidden /> Add Feedback</button>
          </div>
        </div>
      )}
    </article>
  )
}
