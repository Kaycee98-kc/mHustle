import { useMemo, useState } from 'react'
import { ChevronDown, MailCheck, MessageCircle, MessageSquarePlus, Pencil, Search, Trash2, X } from 'lucide-react'
import { Empty, Segmented, useToast } from '../components/ui'
import { bucket, useData } from '../lib/store'
import { friendlyError, supabase } from '../lib/supabase'
import { personName, scheduleKey, scheduleLine, sgtDateTime, shortDate, time12, waLink } from '../lib/format'
import { SCHEDULE_LABEL, TASK_ACTION, type Client, type ScheduleType } from '../lib/types'

type Filter = 'all' | ScheduleType
type Sort = 'newest' | 'oldest' | 'schedule'
const NEW_WINDOW_MS = 24 * 3600_000

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
  const [recorder, setRecorder] = useState<string>('all')
  const [sort, setSort] = useState<Sort>('newest')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const fbCount = useMemo(() => {
    const m = new Map<string, number>()
    feedback.forEach((f) => m.set(f.client_id, (m.get(f.client_id) ?? 0) + 1))
    return m
  }, [feedback])

  const recorders = useMemo(() => {
    const m = new Map<string, number>()
    clients.forEach((c) => { const e = c.created_by_email || ''; m.set(e, (m.get(e) ?? 0) + 1) })
    return [...m.entries()].sort((a, b) => personName(a[0]).localeCompare(personName(b[0])))
  }, [clients])

  const byRecorder = useMemo(
    () => clients.filter((c) => recorder === 'all' || (c.created_by_email || '') === recorder),
    [clients, recorder])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = byRecorder
      .filter((c) => filter === 'all' || c.schedule_type === filter)
      .filter((c) => !needle || [c.name, c.company, c.course, c.partner, c.remarks, personName(c.created_by_email)]
        .some((v) => v.toLowerCase().includes(needle)))
    const added = (c: Client) => c.created_at
    return [...list].sort((a, b) => {
      if (sort === 'oldest') return added(a).localeCompare(added(b))
      if (sort === 'schedule') {
        const ka = scheduleKey(a), kb = scheduleKey(b)
        if (ka && kb) return ka.localeCompare(kb)
        if (ka) return -1
        if (kb) return 1
      }
      return added(b).localeCompare(added(a)) // newest first
    })
  }, [byRecorder, q, filter, sort])

  const sel = clients.filter((c) => selected.has(c.id))
  const toggleSel = (id: string) => setSelected((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allShownSelected = shown.length > 0 && shown.every((c) => selected.has(c.id))
  const selectAllShown = () => setSelected((p) => { const n = new Set(p); if (allShownSelected) shown.forEach((c) => n.delete(c.id)); else shown.forEach((c) => n.add(c.id)); return n })
  const emailable = sel.filter((c) => c.schedule_type === 'potential' && !c.emailed && !c.whatsapped)

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

  const counts = (t: Filter) => (t === 'all' ? byRecorder.length : byRecorder.filter((c) => c.schedule_type === t).length)

  return (
    <div className="stack">
      <div className="search">
        <Search size={18} aria-hidden />
        <input type="search" placeholder="Search clients" value={q}
          onChange={(e) => setQ(e.target.value)} aria-label="Search clients" />
      </div>
      <div className="list-controls">
        <label className="control">
          <span>Recorded by</span>
          <select value={recorder} onChange={(e) => setRecorder(e.target.value)} aria-label="Filter by who recorded the client">
            <option value="all">Everyone ({clients.length})</option>
            {recorders.map(([email, n]) => (
              <option key={email} value={email}>{email ? personName(email) : 'Unknown'} ({n})</option>
            ))}
          </select>
        </label>
        <label className="control">
          <span>Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort clients">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="schedule">Schedule date</option>
          </select>
        </label>
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
        <ClientCard key={c.id} c={c} isNew={now - new Date(c.created_at).getTime() < NEW_WINDOW_MS} open={expandedId === c.id} checked={selected.has(c.id)} onCheck={() => toggleSel(c.id)} feedbackCount={fbCount.get(c.id) ?? 0}
          onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
          onEdit={() => onEdit(c.id)} onAddFeedback={() => onAddFeedback(c.id)} onDeleted={() => onDeleted(c.id)}
          feedback={feedback.filter((f) => f.client_id === c.id)}
          tasks={tasks.filter((t) => t.client_id === c.id)} now={now} />
      ))}
    </div>
  )
}

function ClientCard({ c, isNew, open, checked, onCheck, feedbackCount, onToggle, onEdit, onAddFeedback, onDeleted, feedback, tasks, now }: {
  c: Client; isNew: boolean; open: boolean; checked: boolean; onCheck: () => void; feedbackCount: number; onToggle: () => void; onEdit: () => void; onAddFeedback: () => void; onDeleted: () => void
  feedback: ReturnType<typeof useData>['feedback']; tasks: ReturnType<typeof useData>['tasks']; now: number
}) {
  const { refresh } = useData()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function toggleContact(field: 'emailed' | 'whatsapped', v: boolean) {
    setBusy(true)
    try {
      const { error } = await supabase.from('clients').update({ [field]: v }).eq('id', c.id)
      if (error) throw error
      const label = field === 'emailed' ? 'Emailed' : 'WhatsApp'
      const other = field === 'emailed' ? c.whatsapped : c.emailed
      toast('ok', v
        ? (other ? `${label} recorded.` : `${label} recorded — next-Monday follow-up scheduled.`)
        : (other ? `${label} cleared.` : `${label} cleared — initial-contact follow-up reopened.`))
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
          <div className="client-name">{c.name}{isNew && <span className="new-badge">New</span>}</div>
          <div className="client-sub">{[c.company, c.course].filter(Boolean).join(' · ') || '—'}</div>
          <div className="client-meta">
            <span className={`badge badge-${c.schedule_type}`}>{SCHEDULE_LABEL[c.schedule_type]}</span>
            <span className="muted">{scheduleLine(c)}</span>
            {feedbackCount > 0 && <span className="muted">· {feedbackCount} feedback</span>}
          </div>
          <div className="client-added">Added {sgtDateTime(c.created_at)} · by {personName(c.created_by_email)}</div>
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
            {c.contact && <div className="detail"><dt>Contact</dt><dd>
              <a href={`tel:${c.contact.replace(/[^\d+]/g, '')}`}>{c.contact}</a>
              {waLink(c.contact) && <a className="wa-link" href={waLink(c.contact)!} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} aria-hidden /> WhatsApp</a>}
            </dd></div>}
            {c.email && <div className="detail"><dt>Email</dt><dd><a href={`mailto:${c.email}`}>{c.email}</a></dd></div>}
            {row('Course', c.course)}
            {row('Consultant', c.partner)}
            {row('Remarks', c.remarks, true)}
            {row('Schedule Type', SCHEDULE_LABEL[c.schedule_type])}
            {c.schedule_type !== 'potential' && row(c.schedule_type === 'lesson' ? 'Lesson schedule' : 'Appointment', scheduleLine(c))}
            {row('Recorded by', `${personName(c.created_by_email)} · ${sgtDateTime(c.created_at)}`)}
            {row('Apple Reminders list', c.schedule_type === 'potential' ? 'Follow Up' : 'Clients')}
          </dl>

          {c.schedule_type !== 'potential' && !c.partner.trim() && (
            <p className="nudge">No consultant yet for this {c.schedule_type}. Use Edit Client to add one.</p>
          )}
          {c.schedule_type === 'potential' && (
            <div className="action-done">
              <div className="action-title">Action Done</div>
              <div className="check-row">
                <label className="check">
                  <input type="checkbox" checked={c.emailed} disabled={busy} onChange={(e) => toggleContact('emailed', e.target.checked)} />
                  <span>Emailed{c.emailed_at && <span className="muted"> · {sgtDateTime(c.emailed_at)}</span>}</span>
                </label>
                <label className="check">
                  <input type="checkbox" checked={!!c.whatsapped} disabled={busy} onChange={(e) => toggleContact('whatsapped', e.target.checked)} />
                  <span>WhatsApp{c.whatsapped_at && <span className="muted"> · {sgtDateTime(c.whatsapped_at)}</span>}</span>
                </label>
              </div>
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

          <div className="client-actions">
            <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}><Trash2 size={16} aria-hidden /> Delete</button>
            <button type="button" className="btn btn-ghost" onClick={onEdit}><Pencil size={16} aria-hidden /> Edit Client</button>
            <button type="button" className="btn btn-primary" onClick={onAddFeedback}><MessageSquarePlus size={16} aria-hidden /> Add Feedback</button>
          </div>
        </div>
      )}
    </article>
  )
}
