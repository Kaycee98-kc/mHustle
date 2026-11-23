import { useMemo, useState } from 'react'
import { ChevronDown, MessageSquarePlus, Pencil, Search } from 'lucide-react'
import { Empty, Segmented, useToast } from '../components/ui'
import { bucket, useData } from '../lib/store'
import { friendlyError, supabase } from '../lib/supabase'
import { scheduleLine, sgtDateTime } from '../lib/format'
import { SCHEDULE_LABEL, TASK_ACTION, type Client, type ScheduleType } from '../lib/types'

type Filter = 'all' | ScheduleType

export default function AllClients({ expandedId, setExpandedId, onEdit, onAddFeedback }: {
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  onEdit: (id: string) => void
  onAddFeedback: (id: string) => void
}) {
  const { clients, feedback, tasks, now, loading } = useData()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

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
      {loading && !clients.length ? <Empty>Loading…</Empty> : !shown.length ? <Empty>{clients.length ? 'No clients match your search.' : 'No clients yet. Add one under New Client.'}</Empty> : null}
      {shown.map((c) => (
        <ClientCard key={c.id} c={c} open={expandedId === c.id} feedbackCount={fbCount.get(c.id) ?? 0}
          onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
          onEdit={() => onEdit(c.id)} onAddFeedback={() => onAddFeedback(c.id)}
          feedback={feedback.filter((f) => f.client_id === c.id)}
          tasks={tasks.filter((t) => t.client_id === c.id)} now={now} />
      ))}
    </div>
  )
}

function ClientCard({ c, open, feedbackCount, onToggle, onEdit, onAddFeedback, feedback, tasks, now }: {
  c: Client; open: boolean; feedbackCount: number; onToggle: () => void; onEdit: () => void; onAddFeedback: () => void
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

  const row = (label: string, value: string, pre = false) => value ? (
    <div className="detail"><dt>{label}</dt><dd className={pre ? 'pre' : ''}>{value}</dd></div>
  ) : null

  return (
    <article className={`card client-card${open ? ' open' : ''}`}>
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
                  <div className="pre">{f.content}</div>
                </li>
              ))}
            </ul>
          ) : <p className="muted small">No feedback recorded.</p>}

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={onEdit}><Pencil size={16} aria-hidden /> Edit Client</button>
            <button type="button" className="btn btn-primary" onClick={onAddFeedback}><MessageSquarePlus size={16} aria-hidden /> Add Feedback</button>
          </div>
        </div>
      )}
    </article>
  )
}
