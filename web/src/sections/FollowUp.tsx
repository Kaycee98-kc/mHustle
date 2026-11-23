import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Empty, Segmented, useToast } from '../components/ui'
import { bucket, useData } from '../lib/store'
import { friendlyError, supabase } from '../lib/supabase'
import { sgtDateTime } from '../lib/format'
import { TASK_ACTION, type FollowUpTask } from '../lib/types'

type Tab = 'todo' | 'miss' | 'done'
const PRIORITY_LABEL = { urgent: 'Urgent', high: 'High', normal: 'Normal' } as const
const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2 } as const

export default function FollowUp({ highlightTaskId }: { highlightTaskId: string | null }) {
  const { tasks, clients, feedback, now, refresh } = useData()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('todo')
  const [busy, setBusy] = useState<string | null>(null)
  const highlightRef = useRef<HTMLElement | null>(null)

  const byClient = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients])
  const byFeedback = useMemo(() => new Map(feedback.map((f) => [f.id, f])), [feedback])

  const groups = useMemo(() => {
    const g: Record<Tab, FollowUpTask[]> = { todo: [], miss: [], done: [] }
    tasks.forEach((t) => g[bucket(t, now)].push(t))
    const byPriority = (a: FollowUpTask, b: FollowUpTask) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.due_at.localeCompare(b.due_at)
    g.todo.sort(byPriority); g.miss.sort(byPriority)
    g.done.sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
    return g
  }, [tasks, now])

  useEffect(() => {
    if (!highlightTaskId) return
    const t = tasks.find((x) => x.id === highlightTaskId)
    if (t) setTab(bucket(t, now))
    setTimeout(() => highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightTaskId, tasks.length])

  async function complete(t: FollowUpTask) {
    setBusy(t.id)
    try {
      const { error } = await supabase.from('follow_up_tasks').update({ completed: true }).eq('id', t.id)
      if (error) throw error
      toast('ok', t.task_type === 'initial_email' ? 'Initial email done — client marked Emailed and next-Monday follow-up scheduled.' : 'Follow-up completed.')
      await refresh()
    } catch (e) { toast('error', friendlyError(e)) } finally { setBusy(null) }
  }

  const list = groups[tab]
  return (
    <div className="stack">
      <Segmented<Tab> label="Follow-up category" value={tab} onChange={setTab} options={[
        { value: 'todo', label: 'To Follow Up', count: groups.todo.length },
        { value: 'miss', label: 'Miss', count: groups.miss.length },
        { value: 'done', label: 'Completed', count: groups.done.length },
      ]} />
      {!list.length && <Empty>{tab === 'todo' ? 'Nothing to follow up right now.' : tab === 'miss' ? 'No missed follow-ups.' : 'No completed follow-ups yet.'}</Empty>}
      {list.map((t) => {
        const c = byClient.get(t.client_id)
        const fb = t.feedback_id ? byFeedback.get(t.feedback_id) : undefined
        const detail = fb?.content ?? (t.task_type === 'appointment_feedback' ? t.description : c?.remarks ?? t.description)
        const isHighlight = t.id === highlightTaskId
        return (
          <article key={t.id} ref={isHighlight ? (el) => { highlightRef.current = el } : undefined}
            className={`card task-card prio-${t.priority} state-${tab}${isHighlight ? ' highlight' : ''}`}>
            <label className="task-check">
              <input type="checkbox" checked={t.completed} disabled={t.completed || busy === t.id}
                onChange={() => complete(t)} aria-label={`Mark "${t.title}" as completed`} />
            </label>
            <div className="task-body">
              <div className="task-top">
                <span className="client-name">{c?.name ?? 'Client'}</span>
                <span className={`prio prio-tag-${t.priority}`}>{t.priority === 'urgent' && <AlertTriangle size={12} aria-hidden />} {PRIORITY_LABEL[t.priority]}</span>
              </div>
              {c?.company && <div className="client-sub">{c.company}</div>}
              <div className="task-action">{TASK_ACTION[t.task_type]}</div>
              {detail && <div className="pre task-detail">{detail}</div>}
              {fb && <div className="muted small">Feedback of {sgtDateTime(fb.created_at)}</div>}
              <div className="task-due">
                {tab === 'done'
                  ? <>Due {sgtDateTime(t.due_at)} · Completed {sgtDateTime(t.completed_at)}</>
                  : <>{tab === 'miss' ? 'Was due' : 'Due'} {sgtDateTime(t.due_at)}</>}
              </div>
              {c && tab !== 'done' && (c.contact || c.email) && (
                <div className="task-links">
                  {c.contact && <a href={`tel:${c.contact.replace(/[^\d+]/g, '')}`}>Call</a>}
                  {c.email && <a href={`mailto:${c.email}`}>Email</a>}
                </div>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}
