import { useMemo, useState } from 'react'
import { CalendarDays, ChevronDown, Copy, FileText } from 'lucide-react'
import { Empty, Field, useToast } from '../components/ui'
import { useData } from '../lib/store'
import { friendlyError, supabase } from '../lib/supabase'
import { sgtDateTime, shortDate } from '../lib/format'
import { addDays, longDate, periodFor, sgtDate } from '@shared/time.ts'
import type { WeeklyReport } from '../lib/types'

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true } catch {
    const ta = document.createElement('textarea')
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy'); ta.remove(); return ok
  }
}

export default function Report() {
  const { reports, refresh, now } = useData()
  const toast = useToast()
  const current = periodFor(sgtDate(new Date(now)))
  const [pick, setPick] = useState(current.start)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const chosen = periodFor(pick || current.start)

  const latest = reports[0]
  const grouped = useMemo(() => {
    const m = new Map<string, WeeklyReport[]>()
    reports.forEach((r) => m.set(r.period_start, [...(m.get(r.period_start) ?? []), r]))
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [reports])

  async function generate() {
    const existing = reports.filter((r) => r.period_start === chosen.start)
    if (existing.length && !window.confirm(
      `A report already exists for ${shortDate(chosen.start)} – ${shortDate(chosen.end)}.\n\nCreate version ${Math.max(...existing.map((r) => r.version)) + 1}? Earlier versions are kept.`)) return
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('report', { body: { periodStart: chosen.start } })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      toast('ok', 'Report generated.')
      await refresh()
      if (data?.report?.id) setOpen(data.report.id)
    } catch (e) { toast('error', friendlyError(e)) } finally { setBusy(false) }
  }

  async function copy(r: WeeklyReport) {
    toast(await copyText(r.content) ? 'ok' : 'error', 'Report copied to clipboard.')
  }

  return (
    <div className="stack">
      <div className="card info-grid">
        <div>
          <div className="info-label">Report Schedule</div>
          <div>Every Friday · 11:59 PM · Singapore time</div>
        </div>
        <div>
          <div className="info-label">Current Reporting Period</div>
          <div>{longDate(current.start)} – {longDate(current.end)}</div>
        </div>
      </div>

      <div className="card form">
        <Field label="Reporting period (pick any date in the week)" htmlFor="rp-date">
          <input id="rp-date" type="date" value={pick} max={addDays(current.end, 0)} onChange={(e) => setPick(e.target.value)} />
        </Field>
        <p className="hint"><CalendarDays size={14} aria-hidden /> {longDate(chosen.start)} to {longDate(chosen.end)}</p>
        <div className="form-actions">
          <button type="button" className="btn btn-primary" onClick={generate} disabled={busy}>
            <FileText size={16} aria-hidden /> {busy ? 'Generating…' : 'Generate Weekly Report'}
          </button>
        </div>
      </div>

      <h3>Latest Report</h3>
      {latest ? <ReportView r={latest} onCopy={copy} /> : <Empty>No reports yet. The first automatic report will be generated on Friday at 11:59 PM.</Empty>}

      <h3>Report History</h3>
      {!grouped.length && <Empty>No report history.</Empty>}
      {grouped.map(([start, versions]) => (
        <div key={start} className="card history">
          <div className="history-title">{shortDate(start)} – {shortDate(versions[0].period_end)}</div>
          {versions.map((r) => (
            <div key={r.id} className="history-item">
              <button type="button" className="history-row" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                <span>v{r.version} · {r.generation_type === 'automatic' ? 'Automatic' : 'Manual'}{r.status === 'failed' ? ' · Failed' : ''}</span>
                <span className="muted small">{sgtDateTime(r.generated_at)}</span>
                <ChevronDown size={18} className={open === r.id ? 'rot' : ''} aria-hidden />
              </button>
              {open === r.id && <ReportView r={r} onCopy={copy} bare />}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function ReportView({ r, onCopy, bare }: { r: WeeklyReport; onCopy: (r: WeeklyReport) => void; bare?: boolean }) {
  return (
    <div className={bare ? 'report-bare' : 'card'}>
      <div className="report-meta">
        <span className="muted small">
          {shortDate(r.period_start)} – {shortDate(r.period_end)} · v{r.version} · {r.generation_type === 'automatic' ? 'Automatic' : 'Manual'}
          {r.generator === 'ai' ? ' · AI-assisted' : ''} · {sgtDateTime(r.generated_at)}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onCopy(r)}><Copy size={14} aria-hidden /> Copy Report</button>
      </div>
      <pre className="report-text">{r.content}</pre>
    </div>
  )
}
