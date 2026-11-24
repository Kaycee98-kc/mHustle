import { useMemo } from 'react'
import { AlertTriangle, CalendarDays, ListChecks } from 'lucide-react'
import { useData } from '../lib/store'
import { scheduleKey, time12 } from '../lib/format'
import { longDate, sgtDate } from '@shared/time.ts'
import { SCHEDULE_LABEL } from '../lib/types'

/**
 * "Today" card at the top of Follow Up — the same information as the daily
 * summary push: today's appointments/lessons and follow-ups needing action.
 */
export default function TodaySummary({ onOpenClient, onShowTab }: {
  onOpenClient: (id: string) => void
  onShowTab: (tab: 'todo' | 'miss') => void
}) {
  const { clients, tasks, now } = useData()
  const today = sgtDate(new Date(now))

  const todays = useMemo(() => clients
    .filter((c) =>
      (c.schedule_type === 'appointment' && c.appointment_date === today) ||
      (c.schedule_type === 'lesson' && !!c.lesson_date_from && c.lesson_date_from <= today &&
        (c.lesson_date_to || c.lesson_date_from) >= today))
    .sort((a, b) => (scheduleKey(a) ?? '').slice(11).localeCompare((scheduleKey(b) ?? '').slice(11))), [clients, today])

  const endOfToday = new Date(`${today}T23:59:59+08:00`).getTime()
  const open = tasks.filter((t) => !t.completed && !t.cancelled)
  const action = open.filter((t) => new Date(t.due_at).getTime() <= endOfToday || t.priority === 'urgent')
  const overdue = action.filter((t) => new Date(t.due_at).getTime() < now).length
  const urgent = action.filter((t) => t.priority === 'urgent').length
  const dueToday = action.length - overdue

  return (
    <section className="card today" aria-label="Today's summary">
      <div className="today-head">
        <div>
          <div className="today-label">Today</div>
          <div className="today-date">{longDate(today)}</div>
        </div>
      </div>

      <div className="today-block">
        <div className="today-title"><CalendarDays size={16} aria-hidden /> Appointments &amp; lessons</div>
        {todays.length ? (
          <ul className="today-list">
            {todays.map((c) => (
              <li key={c.id}>
                <button type="button" className="today-item" onClick={() => onOpenClient(c.id)}>
                  <span className="today-time">{time12(c.schedule_type === 'appointment' ? c.appointment_time : c.lesson_time_from)}</span>
                  <span className="today-who">
                    <strong>{c.name}</strong>{c.company && <span className="muted"> · {c.company}</span>}
                    <span className="today-meta">
                      <span className={`badge badge-${c.schedule_type}`}>{SCHEDULE_LABEL[c.schedule_type]}</span>
                      {c.partner ? <span className="muted"> with {c.partner}</span> : <span className="today-warn"> no consultant yet</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="muted small">No appointments or lessons today.</p>}
      </div>

      <div className="today-block">
        <div className="today-title"><ListChecks size={16} aria-hidden /> Follow-ups needing action</div>
        {action.length ? (
          <div className="today-stats">
            <button type="button" className="today-stat" onClick={() => onShowTab('todo')}>
              <span className="n">{dueToday}</span><span>due today</span>
            </button>
            <button type="button" className={`today-stat${overdue ? ' bad' : ''}`} onClick={() => onShowTab('miss')}>
              <span className="n">{overdue}</span><span>overdue</span>
            </button>
            <div className={`today-stat${urgent ? ' bad' : ''}`}>
              <span className="n">{urgent ? <><AlertTriangle size={14} aria-hidden /> {urgent}</> : 0}</span><span>urgent</span>
            </div>
          </div>
        ) : <p className="muted small">Nothing needs action today.</p>}
      </div>
    </section>
  )
}
